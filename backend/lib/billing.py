"""Cobrança recorrente: estado da assinatura de cada empresa.

Fluxo
-----
1. A loja escolhe o plano em "Minha assinatura" → criamos uma assinatura
   (preapproval) pendente no Mercado Pago e mandamos a pessoa para o checkout.
2. O Mercado Pago avisa pelo webhook. Buscamos o recurso na API e aplicamos:
   * assinatura autorizada / pagamento aprovado → ATIVO (e reativa se foi
     suspensa por falta de pagamento);
   * pagamento recusado → INADIMPLENTE + e-mail no dia;
   * assinatura cancelada → continua usando até o fim do período já pago.
3. Rotina diária: 1 dia antes de suspender manda aviso; após
   PAYMENT_GRACE_DAYS dias de atraso suspende (suspended_reason=PAGAMENTO);
   cancelamentos vencidos viram CANCELADO; avisa o fim do teste grátis.

Bloqueio por cobrança (billing_block): teste encerrado, suspensão por pagamento
ou assinatura cancelada. O ADMIN da loja continua entrando, mas só consegue usar
"Minha assinatura" para regularizar; vendedores ficam bloqueados.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

from lib.backups import log_platform_action
from lib.db import db
from lib.email import send_billing_notice
from models.org import (
    FOUNDER_COUPON,
    FOUNDER_DISCOUNT,
    FOUNDER_SLOTS,
    PAYMENT_GRACE_DAYS,
    PLAN_LABELS,
)

logger = logging.getLogger(__name__)

def grace_days() -> int:
    """Dias de tolerância após um pagamento recusado (PAYMENT_GRACE_DAYS no ambiente)."""
    try:
        return max(0, int(os.environ.get("PAYMENT_GRACE_DAYS", PAYMENT_GRACE_DAYS)))
    except ValueError:
        return PAYMENT_GRACE_DAYS


BLOCK_TRIAL = "TESTE_ENCERRADO"
BLOCK_PAYMENT = "PAGAMENTO"
BLOCK_CANCELLED = "CANCELADO"

BLOCK_MESSAGES = {
    BLOCK_TRIAL: "O período de teste grátis terminou. Escolha um plano para continuar usando.",
    BLOCK_PAYMENT: "O acesso está suspenso por falta de pagamento. Atualize o pagamento para liberar.",
    BLOCK_CANCELLED: "A assinatura foi cancelada. Assine um plano para voltar a usar.",
}


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _now() -> datetime:
    return datetime.now(timezone.utc)


def billing_block(org: dict | None) -> str:
    """Why this company may only use the subscription page ("" = no block)."""
    if not org:
        return ""
    if org.get("status") == "SUSPENSA" and org.get("suspended_reason") == BLOCK_PAYMENT:
        return BLOCK_PAYMENT
    if org.get("status") != "APROVADA":
        return ""  # pending / suspended by the owner: handled as a hard block elsewhere
    if org.get("subscription_status") == "CANCELADO":
        return BLOCK_CANCELLED
    if org.get("subscription_status") == "TESTE":
        ends = _aware(org.get("trial_ends_at"))
        if isinstance(ends, datetime) and ends < _now():
            return BLOCK_TRIAL
    return ""


# ------------------------------------------------------------------ preço
async def founder_slots_left() -> int:
    used = await db.organizations.count_documents({"billing.coupon": FOUNDER_COUPON})
    return max(0, FOUNDER_SLOTS - used)


async def price_for(plan: str, coupon: str, org: dict, prices: dict[str, float]) -> tuple[float, str]:
    """Monthly amount for `plan` and the coupon actually applied ("" if none)."""
    base = float(prices.get(plan, 0.0))
    code = (coupon or "").strip().upper()
    already = (org.get("billing") or {}).get("coupon") == FOUNDER_COUPON
    if code == FOUNDER_COUPON or already:
        if already or await founder_slots_left() > 0:
            return round(base * (1 - FOUNDER_DISCOUNT), 2), FOUNDER_COUPON
    return round(base, 2), ""


# ------------------------------------------------------ aplicar eventos do MP
async def _org_for_preapproval(preapproval: dict) -> dict | None:
    org = await db.organizations.find_one({"billing.mp_preapproval_id": preapproval.get("id")})
    if org:
        return org
    ref = preapproval.get("external_reference") or ""
    return await db.organizations.find_one({"id": ref}) if ref else None


async def _activate(org: dict, *, next_payment: datetime | None, extra: dict | None = None) -> None:
    billing = org.get("billing") or {}
    changes: dict = {
        "subscription_status": "ATIVO",
        "billing.payment_failed_at": None,
        "billing.cancel_at": None,
        "reminders_sent": [],
    }
    if billing.get("plan_pending"):
        changes["plan"] = billing["plan_pending"]
        changes["billing.plan_pending"] = None
    if billing.get("plan_next"):
        # mudança para um plano menor: vale a partir da cobrança seguinte
        changes["plan"] = billing["plan_next"]
        changes["billing.plan_next"] = None
    if next_payment:
        changes["due_date"] = next_payment
    if org.get("status") == "SUSPENSA" and org.get("suspended_reason") == BLOCK_PAYMENT:
        changes["status"] = "APROVADA"
        changes["suspended_reason"] = ""
        changes["suspended_at"] = None
    if extra:
        changes.update(extra)
    await db.organizations.update_one({"id": org["id"]}, {"$set": changes})


def _parse_date(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def apply_preapproval(preapproval: dict) -> str:
    """Assinatura mudou no MP (autorizada, pausada, cancelada)."""
    org = await _org_for_preapproval(preapproval)
    if not org:
        logger.warning("Assinatura MP %s sem empresa correspondente", preapproval.get("id"))
        return "ignored"
    status = preapproval.get("status", "")
    billing = org.get("billing") or {}
    if billing.get("mp_preapproval_id") and billing["mp_preapproval_id"] != preapproval.get("id"):
        return "stale"  # an older subscription of this company — the new one rules
    await db.organizations.update_one(
        {"id": org["id"]},
        {"$set": {"billing.mp_status": status, "billing.mp_preapproval_id": preapproval.get("id")}},
    )
    next_payment = _parse_date(preapproval.get("next_payment_date"))

    if status == "authorized":
        await _activate(org, next_payment=next_payment)
        await log_platform_action(
            actor_email="mercadopago",
            action="ASSINATURA_AUTORIZADA",
            target=org.get("name", ""),
            details=f"plano {billing.get('plan_pending') or org.get('plan')}",
        )
        return "active"
    if status == "cancelled":
        # keeps working until the end of the period already paid
        until = _aware(org.get("due_date")) or _now()
        await db.organizations.update_one(
            {"id": org["id"]}, {"$set": {"billing.cancel_at": max(until, _now())}}
        )
        await log_platform_action(
            actor_email="mercadopago",
            action="ASSINATURA_CANCELADA",
            target=org.get("name", ""),
            details=f"acesso até {max(until, _now()).date().isoformat()}",
        )
        return "cancelled"
    if status == "paused":
        await _mark_payment_failed(org, reason="assinatura pausada no Mercado Pago")
        return "paused"
    return "noop"


async def apply_authorized_payment(payment: dict, preapproval: dict | None) -> str:
    """Cobrança mensal processada (aprovada, recusada, em nova tentativa)."""
    target = preapproval or {"id": payment.get("preapproval_id"), "external_reference": ""}
    org = await _org_for_preapproval(target)
    if not org:
        logger.warning("Pagamento MP %s sem empresa correspondente", payment.get("id"))
        return "ignored"
    inner = payment.get("payment") or {}
    pay_status = (inner.get("status") or payment.get("status") or "").lower()
    amount = float(payment.get("transaction_amount") or 0)

    if pay_status == "approved":
        next_payment = _parse_date((preapproval or {}).get("next_payment_date"))
        await _activate(org, next_payment=next_payment, extra={"billing.last_payment_at": _now()})
        await db.billing_payments.update_one(
            {"mp_id": str(payment.get("id"))},
            {
                "$setOnInsert": {
                    "mp_id": str(payment.get("id")),
                    "org_id": org["id"],
                    "amount": amount,
                    "status": "approved",
                    "created_at": _now(),
                }
            },
            upsert=True,
        )
        return "paid"
    if pay_status in ("rejected", "cancelled", "recycling"):
        await _mark_payment_failed(org, reason="pagamento recusado pelo cartão")
        return "failed"
    return "noop"


async def _mark_payment_failed(org: dict, *, reason: str) -> None:
    billing = org.get("billing") or {}
    first_failure = billing.get("payment_failed_at") is None
    changes: dict = {"billing.payment_failed_at": billing.get("payment_failed_at") or _now()}
    if org.get("subscription_status") == "ATIVO":
        changes["subscription_status"] = "INADIMPLENTE"
    await db.organizations.update_one({"id": org["id"]}, {"$set": changes})
    if first_failure:
        await log_platform_action(
            actor_email="mercadopago",
            action="PAGAMENTO_RECUSADO",
            target=org.get("name", ""),
            details=reason,
        )
        await _notify(
            org,
            "Pagamento não aprovado",
            [
                f"Não conseguimos cobrar a assinatura da empresa {org.get('name', '')} ({reason}).",
                f"O Mercado Pago vai tentar de novo. Se não for regularizado em "
                f"{grace_days()} dias, o acesso será suspenso.",
                "Para evitar, confira o cartão ou troque a forma de pagamento em Minha assinatura.",
            ],
        )


async def _notify(org: dict, subject: str, paragraphs: list[str]) -> None:
    email = (org.get("owner_email") or "").strip()
    if not email:
        return
    try:
        await send_billing_notice(
            to=email, name=org.get("owner_name", ""), subject=subject, paragraphs=paragraphs
        )
    except Exception as exc:  # noqa: BLE001 — an e-mail outage must not stop billing
        logger.warning("Aviso de cobrança não enviado para %s: %s", email, exc)


# ---------------------------------------------------------------- rotina diária
async def run_billing_daily() -> dict:
    """Suspende após a tolerância, avisa antes, encerra cancelamentos vencidos e
    avisa o fim do teste grátis. Idempotente: pode rodar mais de uma vez por dia."""
    now = _now()
    suspended = warned = closed = trial_warned = 0
    orgs = await db.organizations.find({"status": "APROVADA"}).to_list(5000)
    for org in orgs:
        billing = org.get("billing") or {}
        sent = set(org.get("reminders_sent") or [])

        failed_at = _aware(billing.get("payment_failed_at"))
        if failed_at and org.get("subscription_status") == "INADIMPLENTE":
            late_days = (now - failed_at).days
            if late_days >= grace_days():
                await db.organizations.update_one(
                    {"id": org["id"], "status": "APROVADA"},
                    {"$set": {"status": "SUSPENSA", "suspended_reason": BLOCK_PAYMENT, "suspended_at": now}},
                )
                await log_platform_action(
                    actor_email="sistema",
                    action="SUSPENSA_POR_PAGAMENTO",
                    target=org.get("name", ""),
                    details=f"{late_days} dia(s) sem pagamento",
                )
                await _notify(
                    org,
                    "Acesso suspenso",
                    [
                        f"O acesso da empresa {org.get('name', '')} foi suspenso por falta de pagamento.",
                        "Seus dados estão guardados. Assim que o pagamento for aprovado, o acesso volta sozinho.",
                    ],
                )
                suspended += 1
                continue
            marker = f"suspensao-amanha:{failed_at.date().isoformat()}"
            if late_days == grace_days() - 1 and marker not in sent:
                await _notify(
                    org,
                    "Seu acesso será suspenso amanhã",
                    [
                        f"A assinatura da empresa {org.get('name', '')} continua sem pagamento.",
                        "Se não for regularizada até amanhã, o acesso ao sistema será suspenso.",
                    ],
                )
                await db.organizations.update_one({"id": org["id"]}, {"$addToSet": {"reminders_sent": marker}})
                warned += 1

        cancel_at = _aware(billing.get("cancel_at"))
        if cancel_at and cancel_at <= now and org.get("subscription_status") != "CANCELADO":
            await db.organizations.update_one(
                {"id": org["id"]}, {"$set": {"subscription_status": "CANCELADO"}}
            )
            closed += 1

        if org.get("subscription_status") == "TESTE":
            ends = _aware(org.get("trial_ends_at"))
            if ends and timedelta(0) < ends - now <= timedelta(days=1):
                marker = f"teste-acaba:{ends.date().isoformat()}"
                if marker not in sent:
                    await _notify(
                        org,
                        "Seu teste grátis termina amanhã",
                        [
                            f"O período de teste da empresa {org.get('name', '')} termina em menos de 24 horas.",
                            "Escolha um plano em Minha assinatura para continuar usando sem interrupção.",
                        ],
                    )
                    await db.organizations.update_one(
                        {"id": org["id"]}, {"$addToSet": {"reminders_sent": marker}}
                    )
                    trial_warned += 1

    # suspended-for-payment companies are no longer APROVADA — nothing else to do
    result = {"suspended": suspended, "warned": warned, "closed": closed, "trial_warned": trial_warned}
    logger.info("Rotina de cobrança: %s", result)
    return result


def plan_label(plan: str) -> str:
    return PLAN_LABELS.get(plan, plan)
