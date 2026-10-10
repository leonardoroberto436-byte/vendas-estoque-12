"""Minha assinatura + webhook do Mercado Pago — mounted under /api/billing.

* /billing, /billing/subscribe, /billing/change-plan, /billing/cancel: só o ADMIN
  da loja, e funcionam mesmo com a empresa bloqueada por cobrança (é por aqui que
  ela se regulariza).
* /billing/webhook: público, autenticado pela assinatura `x-signature` do
  Mercado Pago. Nunca confia no corpo: busca o recurso na API do MP.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from lib import mercadopago as mp
from lib.auth import Principal, require_billing_admin
from lib.billing import (
    apply_authorized_payment,
    apply_preapproval,
    billing_block,
    founder_slots_left,
    grace_days,
    plan_label,
    price_for,
)
from lib.backups import log_platform_action
from lib.db import db
from lib.email import app_url
from lib.plans import get_plan_limits, limits_for_org, usage_for_org
from lib.subscriptions import get_plan_prices
from models.org import (
    PAID_PLANS,
    BillingInfo,
    ChangePlanRequest,
    PlanLimit,
    SubscribeRequest,
    SubscribeResponse,
    UsageItem,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["billing"])


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _not_configured() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail="A cobrança online ainda não está ativada. Fale com o suporte para assinar.",
    )


async def _org(principal: Principal) -> dict:
    org = await db.organizations.find_one({"id": principal.org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    return org


@router.get("", response_model=BillingInfo)
async def billing_info(principal: Principal = Depends(require_billing_admin)):
    org = await _org(principal)
    billing = org.get("billing") or {}
    prices = await get_plan_prices()
    limits = await limits_for_org(org)
    usage = await usage_for_org(org["id"])
    failed = _aware(billing.get("payment_failed_at"))
    return BillingInfo(
        plan=org.get("plan", "TESTE"),
        plan_label=plan_label(org.get("plan", "TESTE")),
        subscription_status=org.get("subscription_status", "TESTE"),
        status=org.get("status", "APROVADA"),
        trial_ends_at=_aware(org.get("trial_ends_at")),
        trial_expired=billing_block(org) == "TESTE_ENCERRADO",
        due_date=_aware(org.get("due_date")),
        price=float(billing.get("amount") or prices.get(org.get("plan", ""), 0.0)),
        coupon=billing.get("coupon") or "",
        mp_status=billing.get("mp_status") or "",
        payment_failed_at=failed,
        suspend_on=failed + timedelta(days=grace_days()) if failed else None,
        cancel_at=_aware(billing.get("cancel_at")),
        plan_next=billing.get("plan_next") or "",
        billing_block=billing_block(org),
        billing_enabled=mp.configured(),
        founder_slots_left=await founder_slots_left(),
        prices={p: prices.get(p, 0.0) for p in PAID_PLANS},
        limits={
            plan: PlanLimit(**values)
            for plan, values in (await get_plan_limits()).items()
            if plan in PAID_PLANS
        },
        usage={
            "users": UsageItem(used=usage["users"], limit=limits.get("users")),
            "products": UsageItem(used=usage["products"], limit=limits.get("products")),
        },
    )


@router.post("/subscribe", response_model=SubscribeResponse)
async def subscribe(payload: SubscribeRequest, principal: Principal = Depends(require_billing_admin)):
    """Cria a assinatura no Mercado Pago e devolve o link do checkout."""
    if not mp.configured():
        raise _not_configured()
    org = await _org(principal)
    billing = org.get("billing") or {}
    if billing.get("mp_status") == "authorized" and not billing.get("cancel_at"):
        raise HTTPException(
            status_code=409,
            detail="Sua assinatura já está ativa. Para trocar de plano use 'Mudar de plano'.",
        )

    prices = await get_plan_prices()
    amount, coupon = await price_for(payload.plan, payload.coupon, org, prices)
    if payload.coupon.strip() and not coupon:
        raise HTTPException(status_code=400, detail="Cupom inválido ou esgotado.")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Plano sem preço definido. Fale com o suporte.")

    base = app_url()
    if not base:
        raise HTTPException(status_code=503, detail="Endereço do site não configurado (APP_PUBLIC_URL).")
    try:
        preapproval = await mp.create_preapproval(
            reason=f"{org.get('name', '')} — plano {plan_label(payload.plan)}",
            external_reference=org["id"],
            payer_email=str(payload.payer_email or principal.email),
            amount=amount,
            back_url=f"{base}/assinatura?retorno=mercadopago",
        )
    except mp.MercadoPagoError as exc:
        logger.error("Criação de assinatura falhou para %s: %s", org["id"], exc)
        raise HTTPException(status_code=400, detail=mp.friendly_error(exc))

    checkout = preapproval.get("init_point") or ""
    if not preapproval.get("id") or not checkout:
        raise HTTPException(status_code=502, detail="O Mercado Pago não devolveu o link de pagamento.")

    await db.organizations.update_one(
        {"id": org["id"]},
        {
            "$set": {
                "billing.mp_preapproval_id": preapproval["id"],
                "billing.mp_status": preapproval.get("status", "pending"),
                "billing.plan_pending": payload.plan,
                "billing.plan_next": None,
                "billing.amount": amount,
                "billing.coupon": coupon or billing.get("coupon") or "",
                "billing.created_at": datetime.now(timezone.utc),
            }
        },
    )
    await log_platform_action(
        actor_email=principal.email,
        action="ASSINATURA_INICIADA",
        target=org.get("name", ""),
        details=f"plano {payload.plan} · R$ {amount:.2f}" + (f" · cupom {coupon}" if coupon else ""),
    )
    return SubscribeResponse(
        checkout_url=checkout,
        message="Você será levado ao Mercado Pago para cadastrar o cartão.",
    )


@router.post("/change-plan", response_model=BillingInfo)
async def change_plan(payload: ChangePlanRequest, principal: Principal = Depends(require_billing_admin)):
    """Plano maior: vale na hora. Plano menor: vale a partir da próxima cobrança."""
    if not mp.configured():
        raise _not_configured()
    org = await _org(principal)
    billing = org.get("billing") or {}
    if billing.get("mp_status") != "authorized" or not billing.get("mp_preapproval_id"):
        raise HTTPException(status_code=409, detail="Assine um plano primeiro.")
    if payload.plan == org.get("plan") and not billing.get("plan_next"):
        raise HTTPException(status_code=400, detail="Você já está neste plano.")

    prices = await get_plan_prices()
    amount, _ = await price_for(payload.plan, billing.get("coupon") or "", org, prices)
    try:
        await mp.update_preapproval(
            billing["mp_preapproval_id"],
            {
                "reason": f"{org.get('name', '')} — plano {plan_label(payload.plan)}",
                "auto_recurring": {"transaction_amount": amount, "currency_id": "BRL"},
            },
        )
    except mp.MercadoPagoError as exc:
        logger.error("Troca de plano falhou para %s: %s", org["id"], exc)
        raise HTTPException(status_code=400, detail=mp.friendly_error(exc))

    upgrade = prices.get(payload.plan, 0) >= prices.get(org.get("plan", ""), 0)
    changes: dict = {"billing.amount": amount}
    if upgrade:
        changes["plan"] = payload.plan
        changes["billing.plan_next"] = None
    else:
        changes["billing.plan_next"] = payload.plan
    await db.organizations.update_one({"id": org["id"]}, {"$set": changes})
    await log_platform_action(
        actor_email=principal.email,
        action="PLANO_TROCADO_PELA_LOJA",
        target=org.get("name", ""),
        details=f"{org.get('plan')} → {payload.plan} ({'agora' if upgrade else 'na próxima cobrança'}) · R$ {amount:.2f}",
    )
    return await billing_info(principal)


@router.post("/cancel", response_model=BillingInfo)
async def cancel(principal: Principal = Depends(require_billing_admin)):
    """Cancela a renovação. A loja usa até o fim do período já pago."""
    if not mp.configured():
        raise _not_configured()
    org = await _org(principal)
    billing = org.get("billing") or {}
    if not billing.get("mp_preapproval_id"):
        raise HTTPException(status_code=409, detail="Não há assinatura para cancelar.")
    try:
        await mp.update_preapproval(billing["mp_preapproval_id"], {"status": "cancelled"})
    except mp.MercadoPagoError as exc:
        logger.error("Cancelamento falhou para %s: %s", org["id"], exc)
        raise HTTPException(status_code=400, detail=mp.friendly_error(exc))
    until = _aware(org.get("due_date")) or datetime.now(timezone.utc)
    await db.organizations.update_one(
        {"id": org["id"]},
        {"$set": {"billing.mp_status": "cancelled", "billing.cancel_at": max(until, datetime.now(timezone.utc))}},
    )
    await log_platform_action(
        actor_email=principal.email,
        action="ASSINATURA_CANCELADA_PELA_LOJA",
        target=org.get("name", ""),
        details=f"acesso até {max(until, datetime.now(timezone.utc)).date().isoformat()}",
    )
    return await billing_info(principal)


# ------------------------------------------------------------------ webhook
@router.post("/webhook")
async def mercadopago_webhook(
    request: Request,
    x_signature: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None),
):
    """Notificações do Mercado Pago. Responde 200 rápido; 500 faz o MP tentar de novo."""
    if not mp.webhook_secret() or not mp.configured():
        raise HTTPException(status_code=503, detail="Webhook não configurado")

    params = request.query_params
    try:
        body = await request.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    kind = params.get("type") or params.get("topic") or body.get("type") or ""
    data_id = params.get("data.id") or str((body.get("data") or {}).get("id") or params.get("id") or "")

    if not mp.signature_is_valid(x_signature or "", x_request_id or "", data_id):
        logger.warning("Webhook MP com assinatura inválida (type=%s id=%s)", kind, data_id)
        raise HTTPException(status_code=401, detail="Assinatura inválida")
    if not data_id:
        return {"status": "ignored"}

    try:
        if kind == "subscription_preapproval":
            result = await apply_preapproval(await mp.get_preapproval(data_id))
        elif kind == "subscription_authorized_payment":
            payment = await mp.get_authorized_payment(data_id)
            preapproval = None
            if payment.get("preapproval_id"):
                preapproval = await mp.get_preapproval(str(payment["preapproval_id"]))
            result = await apply_authorized_payment(payment, preapproval)
        else:
            result = "ignored"
    except mp.MercadoPagoError as exc:
        logger.error("Webhook MP %s %s: %s", kind, data_id, exc)
        raise HTTPException(status_code=500, detail="Tente novamente")

    await db.billing_events.insert_one(
        {
            "type": kind,
            "data_id": data_id,
            "request_id": x_request_id or "",
            "result": result,
            "created_at": datetime.now(timezone.utc),
        }
    )
    return {"status": result}
