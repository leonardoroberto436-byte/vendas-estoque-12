"""Cliente mínimo da API de Assinaturas do Mercado Pago (preapproval).

Configuração (variáveis de ambiente, nunca no código):
* MP_ACCESS_TOKEN     — Access Token da aplicação (comece pelo de TESTE).
* MP_WEBHOOK_SECRET   — "assinatura secreta" das notificações (Suas integrações →
                        Webhooks). Sem ela as notificações são recusadas.
* MP_API_BASE         — só para testes automatizados (servidor falso). Padrão:
                        https://api.mercadopago.com

O webhook nunca confia no corpo da notificação: ele só usa o id para buscar o
recurso direto na API do Mercado Pago e decide a partir dessa resposta.
"""

import hashlib
import hmac
import logging
import os

import httpx

logger = logging.getLogger(__name__)

API_BASE = os.environ.get("MP_API_BASE", "https://api.mercadopago.com").rstrip("/")


def access_token() -> str:
    """Só vale um token de verdade (TEST-… ou APP_USR-…). Um valor provisório
    como "PREENCHER" conta como "não configurado" em vez de quebrar a cobrança."""
    token = os.environ.get("MP_ACCESS_TOKEN", "").strip()
    return token if token.startswith(("TEST-", "APP_USR-")) else ""


def webhook_secret() -> str:
    return os.environ.get("MP_WEBHOOK_SECRET", "").strip()


def configured() -> bool:
    return bool(access_token())


class MercadoPagoError(Exception):
    def __init__(self, message: str, mp_message: str = "", status: int = 0):
        super().__init__(message)
        # a frase de erro que o próprio Mercado Pago devolveu (sem dados sensíveis)
        self.mp_message = mp_message
        self.status = status


# Erros comuns do Mercado Pago, em português, para o dono da loja entender.
_FRIENDLY = (
    ("payer and collector cannot be the same", "O e-mail do pagador é o da própria conta que recebe os pagamentos. Use a conta Mercado Pago de outra pessoa."),
    ("user bad request", "O Mercado Pago não aceitou o e-mail do pagador. Use o e-mail de uma conta Mercado Pago real."),
    ("both payer and collector must be", "Em modo de teste, use o e-mail do comprador de teste do Mercado Pago."),
    ("cannot operate between different countries", "A conta do pagador é de outro país."),
    ("payer_email", "Confira o e-mail da conta Mercado Pago informado."),
    ("invalid access token", "Chave do Mercado Pago inválida (MP_ACCESS_TOKEN)."),
    ("unauthorized", "Chave do Mercado Pago inválida (MP_ACCESS_TOKEN)."),
)


def friendly_error(exc: "MercadoPagoError") -> str:
    raw = (exc.mp_message or "").strip()
    low = raw.lower()
    for needle, text in _FRIENDLY:
        if needle in low:
            return f"{text} (Mercado Pago: {raw[:160]})"
    if raw:
        return f"O Mercado Pago recusou: {raw[:200]}"
    return "Não foi possível falar com o Mercado Pago. Tente de novo."


async def _request(method: str, path: str, json: dict | None = None) -> dict:
    token = access_token()
    if not token:
        raise MercadoPagoError("MP_ACCESS_TOKEN não configurado")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=25) as client:
            resp = await client.request(
                method,
                path,
                json=json,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise MercadoPagoError(f"Mercado Pago indisponível: {exc}") from exc
    if resp.status_code >= 400:
        # never log the token; the body only has MP's own error message
        logger.error("Mercado Pago %s %s -> %s %s", method, path, resp.status_code, resp.text[:300])
        try:
            body = resp.json()
            mp_message = str(body.get("message") or body.get("error") or "")
        except ValueError:
            mp_message = ""
        raise MercadoPagoError(
            f"Mercado Pago respondeu {resp.status_code}", mp_message=mp_message, status=resp.status_code
        )
    return resp.json()


async def create_preapproval(
    *, reason: str, external_reference: str, payer_email: str, amount: float, back_url: str
) -> dict:
    """Assinatura sem plano associado, com pagamento pendente: o MP devolve um
    `init_point` (link do checkout) onde o cliente cadastra o cartão."""
    body = {
        "reason": reason[:250],
        "external_reference": external_reference,
        "payer_email": payer_email,
        "auto_recurring": {
            "frequency": 1,
            "frequency_type": "months",
            "transaction_amount": round(float(amount), 2),
            "currency_id": "BRL",
        },
        "back_url": back_url,
        "status": "pending",
    }
    return await _request("POST", "/preapproval", body)


async def get_preapproval(preapproval_id: str) -> dict:
    return await _request("GET", f"/preapproval/{preapproval_id}")


async def update_preapproval(preapproval_id: str, changes: dict) -> dict:
    return await _request("PUT", f"/preapproval/{preapproval_id}", changes)


async def get_authorized_payment(payment_id: str) -> dict:
    return await _request("GET", f"/authorized_payments/{payment_id}")


def signature_is_valid(x_signature: str, x_request_id: str, data_id: str) -> bool:
    """Valida o cabeçalho `x-signature` (ts=...,v1=...) enviado pelo Mercado Pago.

    Manifesto: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" assinado com
    HMAC-SHA256 usando a assinatura secreta. Ids alfanuméricos vão em minúsculas.
    """
    secret = webhook_secret()
    if not secret or not x_signature:
        return False
    parts: dict[str, str] = {}
    for piece in x_signature.split(","):
        key, _, value = piece.strip().partition("=")
        parts[key.strip()] = value.strip()
    ts, received = parts.get("ts", ""), parts.get("v1", "")
    if not ts or not received:
        return False
    manifest = ""
    if data_id:
        manifest += f"id:{data_id.lower() if data_id.isalnum() else data_id};"
    if x_request_id:
        manifest += f"request-id:{x_request_id};"
    manifest += f"ts:{ts};"
    expected = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received)
