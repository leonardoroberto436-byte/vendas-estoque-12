"""Transactional email through Emergent's managed integration.

Only this module sends mail. Recipients always come from server-side records and
bodies always come from the fixed templates below — no route ever accepts a
recipient, subject or HTML body from the caller.
"""

import ipaddress
import logging
import os
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()
logger = logging.getLogger(__name__)

# Emergent managed email proxy. Constant on purpose — an env var would go missing
# in the deployed app.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
# Brevo (fora do Emergent). Com BREVO_API_KEY preenchida, o envio vai pelo Brevo.
# EMAIL_FROM_ADDRESS precisa ser um remetente verificado no painel do Brevo.
def _normalize_brevo_key(raw: str) -> str:
    """Aceita a chave de API (xkeysib-...) ou a chave "API/MCP" do Brevo,
    que vem em base64 com um JSON {"api_key": "xkeysib-..."} dentro."""
    key = raw.strip().strip('"').strip("'")
    if key.startswith("BREVO_API_KEY="):
        key = key.split("=", 1)[1].strip()
    if key and not key.startswith("xkeysib-"):
        try:
            import base64
            import json

            pad = "=" * (-len(key) % 4)
            data = json.loads(base64.b64decode(key + pad, validate=False).decode("utf-8"))
            inner = str(data.get("api_key", "")).strip()
            if inner.startswith("xkeysib-"):
                return inner
        except Exception:  # noqa: BLE001
            pass
    return key


BREVO_API_KEY = _normalize_brevo_key(os.environ.get("BREVO_API_KEY", ""))
BREVO_URL = "https://api.brevo.com/v3/smtp/email"
EMAIL_FROM_ADDRESS = os.environ.get("EMAIL_FROM_ADDRESS", "").strip()
# nome da marca (mude aqui ou pela variável EMAIL_FROM_NAME)
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Estoque Pro")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")


def app_url() -> str:
    """Absolute https base for links in emails."""
    raw = (os.environ.get("APP_PUBLIC_URL") or os.environ.get("APP_URL") or "").strip()
    raw = raw.rstrip("/")
    if raw.startswith("http://"):
        raw = "https://" + raw[len("http://") :]
    if not raw.startswith("https://"):
        return ""
    return raw


# --------------------------------------------------------------- guardrail gate
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = (
    "reply with your password",
    "reply with the code",
    "send your password",
    "cvv",
    "send us your password",
    "enter your password below",
    "confirm your card number",
    "your full card number",
    "seed phrase",
    "recovery phrase",
    "verify your card",
    "social security number",
    "confirm your bank details",
)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


# ----------------------------------------------------------------------- sender
async def send_email(*, to: str, subject: str, html: str, reply_to: str | None = None) -> str | None:
    _assert_safe_email(subject, html)  # G2-G3 gate — never skip
    if BREVO_API_KEY:
        return await _send_brevo(to=to, subject=subject, html=html, reply_to=reply_to or EMAIL_REPLY_TO)
    if not EMAIL_KEY:
        logger.warning("EMERGENT_EMAIL_KEY ausente — e-mail não enviado para %s", to)
        return None
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if reply_to or EMAIL_REPLY_TO:
        payload["contact_email"] = reply_to or EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        try:
            code = e.response.json().get("code", "")
            message = e.response.json().get("message", "")
        except ValueError:
            code, message = "", ""
        if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
            logger.warning("Email paused: %s (%s): %s", code, e.response.status_code, message)
            raise HTTPException(status_code=503, detail="E-mail temporariamente indisponível")
        logger.error("Email send failed: %s %s", e.response.status_code, e.response.text)
        raise HTTPException(status_code=502, detail="Falha ao enviar o e-mail")
    except Exception as e:  # noqa: BLE001
        logger.error("Email send error: %s", str(e))
        raise HTTPException(status_code=500, detail="Falha ao enviar o e-mail")


async def _send_brevo(*, to: str, subject: str, html: str, reply_to: str | None) -> str | None:
    if not EMAIL_FROM_ADDRESS:
        logger.warning("EMAIL_FROM_ADDRESS ausente — e-mail não enviado para %s", to)
        return None
    payload: dict = {
        "sender": {"name": EMAIL_FROM_NAME, "email": EMAIL_FROM_ADDRESS},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
    }
    if reply_to:
        payload["replyTo"] = {"email": reply_to}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                BREVO_URL,
                headers={"api-key": BREVO_API_KEY, "accept": "application/json"},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("messageId")
    except httpx.HTTPStatusError as e:
        # nunca registra a chave; só o status e a mensagem do provedor
        logger.error("Brevo recusou o envio: %s %s", e.response.status_code, e.response.text[:300])
        if e.response.status_code == 401:
            # diagnóstico sem expor a chave: só o formato (prefixo público) e o tamanho
            logger.error(
                "Formato da BREVO_API_KEY: prefixo=%s tamanho=%d",
                BREVO_API_KEY[:8] if BREVO_API_KEY.startswith("xk") else "outro",
                len(BREVO_API_KEY),
            )
        if e.response.status_code in (402, 429):
            raise HTTPException(status_code=503, detail="E-mail temporariamente indisponível")
        raise HTTPException(status_code=502, detail="Falha ao enviar o e-mail")
    except Exception as e:  # noqa: BLE001
        logger.error("Brevo erro: %s", type(e).__name__)
        raise HTTPException(status_code=500, detail="Falha ao enviar o e-mail")


_SHELL = (
    '<table role="presentation" width="100%" style="background:#f1f5f9;padding:24px 0">'
    '<tr><td align="center">'
    '<table role="presentation" width="560" style="background:#ffffff;border-radius:12px;'
    'border:1px solid #e2e8f0"><tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;'
    'color:#0f172a;font-size:15px;line-height:1.6">{body}'
    '<p style="margin-top:28px;font-size:12px;color:#8a94a6">Enviado por {brand}. '
    "Nunca pedimos sua senha ou dados de cartão por e-mail.</p>"
    "</td></tr></table></td></tr></table>"
)


def _wrap(body: str) -> str:
    return _SHELL.format(body=body, brand=escape(EMAIL_FROM_NAME))


# --------------------------------------------------------------------- templates
async def send_password_reset(*, to: str, name: str, token: str, minutes: int) -> str | None:
    """Single-use expiring reset link. The token is the only thing in the URL."""
    base = app_url()
    if not base:
        logger.warning("APP_PUBLIC_URL ausente — link de redefinição não pôde ser montado")
        return None
    link = f"{base}/redefinir-senha?token={token}"
    body = (
        f"<p>Olá {escape(name)},</p>"
        f"<p>Recebemos um pedido para redefinir a senha da sua conta no "
        f"{escape(EMAIL_FROM_NAME)}.</p>"
        f'<p style="margin:28px 0"><a href="{link}" '
        f'style="background:#0d9488;color:#ffffff;text-decoration:none;padding:12px 22px;'
        f'border-radius:8px;font-weight:bold;display:inline-block">Criar nova senha</a></p>'
        f"<p>O link expira em {minutes} minutos e pode ser usado uma única vez.</p>"
        f"<p>Se não foi você que pediu, ignore esta mensagem — sua senha atual continua valendo.</p>"
    )
    return await send_email(
        to=to, subject=f"Redefinição de senha — {EMAIL_FROM_NAME}", html=_wrap(body)
    )


async def send_signup_pending(*, to: str, name: str, company: str) -> str | None:
    body = (
        f"<p>Olá {escape(name)},</p>"
        f"<p>Recebemos o cadastro da empresa <strong>{escape(company)}</strong> no "
        f"{escape(EMAIL_FROM_NAME)}.</p>"
        f"<p>Sua conta está <strong>aguardando liberação</strong>. Assim que for aprovada, "
        f"você recebe um aviso neste e-mail e já pode entrar com a senha que cadastrou.</p>"
    )
    return await send_email(
        to=to, subject=f"Cadastro recebido — {EMAIL_FROM_NAME}", html=_wrap(body)
    )


async def send_org_approved(*, to: str, name: str, company: str, trial_days: int) -> str | None:
    base = app_url()
    cta = ""
    if base:
        cta = (
            f'<p style="margin:28px 0"><a href="{base}/login" '
            f'style="background:#0d9488;color:#ffffff;text-decoration:none;padding:12px 22px;'
            f'border-radius:8px;font-weight:bold;display:inline-block">Entrar agora</a></p>'
        )
    body = (
        f"<p>Olá {escape(name)},</p>"
        f"<p>A empresa <strong>{escape(company)}</strong> foi liberada no "
        f"{escape(EMAIL_FROM_NAME)}.</p>"
        f"<p>Seu período de teste de {trial_days} dias começa agora. Entre com o e-mail e a "
        f"senha que você cadastrou.</p>{cta}"
    )
    return await send_email(
        to=to, subject=f"Acesso liberado — {EMAIL_FROM_NAME}", html=_wrap(body)
    )


async def send_due_reminder(
    *,
    to: str,
    name: str,
    company: str,
    days: int,
    due_date: str,
    amount: float,
    plan_label: str,
) -> str | None:
    """Subscription due-date notice. Sent 7/3/1 days before and on the due date."""
    when = (
        "vence hoje"
        if days == 0
        else f"vence em {days} dia" + ("s" if days > 1 else "")
    )
    value = f"R$ {amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    base = app_url()
    cta = ""
    if base:
        cta = (
            f'<p style="margin:28px 0"><a href="{base}/login" '
            f'style="background:#0d9488;color:#ffffff;text-decoration:none;padding:12px 22px;'
            f'border-radius:8px;font-weight:bold;display:inline-block">Abrir o sistema</a></p>'
        )
    body = (
        f"<p>Ol\u00e1 {escape(name)},</p>"
        f"<p>A assinatura da empresa <strong>{escape(company)}</strong> no "
        f"{escape(EMAIL_FROM_NAME)} <strong>{when}</strong> ({escape(due_date)}).</p>"
        f"<p>Plano {escape(plan_label)} \u00b7 {escape(value)} por m\u00eas.</p>"
        f"<p>Mantenha o pagamento em dia para continuar usando o sistema sem interrup\u00e7\u00e3o. "
        f"Se j\u00e1 pagou, desconsidere este aviso.</p>{cta}"
    )
    subject = (
        f"Assinatura vence hoje \u2014 {EMAIL_FROM_NAME}"
        if days == 0
        else f"Sua assinatura vence em {days} dia{'s' if days > 1 else ''} \u2014 {EMAIL_FROM_NAME}"
    )
    return await send_email(to=to, subject=subject, html=_wrap(body))


async def send_billing_notice(*, to: str, name: str, subject: str, paragraphs: list[str]) -> str | None:
    """Avisos de assinatura (teste acabando, pagamento recusado, suspensão).

    Os textos vêm sempre de lib/billing.py — nunca do usuário — e são escapados aqui.
    """
    base = app_url()
    cta = ""
    if base:
        cta = (
            f'<p style="margin:28px 0"><a href="{base}/assinatura" '
            f'style="background:#0d9488;color:#ffffff;text-decoration:none;padding:12px 22px;'
            f'border-radius:8px;font-weight:bold;display:inline-block">Abrir minha assinatura</a></p>'
        )
    body = f"<p>Olá {escape(name)},</p>" + "".join(f"<p>{escape(p)}</p>" for p in paragraphs) + cta
    return await send_email(to=to, subject=f"{subject} — {EMAIL_FROM_NAME}", html=_wrap(body))
