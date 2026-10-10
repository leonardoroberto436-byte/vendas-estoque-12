"""Limites por plano — o que cada plano permite e onde isso é conferido.

Regras:
* Os limites de cada plano ficam em `platform_settings` (id "limits") e o dono
  edita pelo painel; DEFAULT_PLAN_LIMITS é só o ponto de partida.
* Cada empresa pode ter uma exceção (`limit_overrides`: usuários/produtos a mais).
* Atingiu o limite: só a CRIAÇÃO de itens novos é bloqueada. Nada é apagado nem
  escondido — quem baixa de plano continua vendo e usando tudo o que já tem.
* Toda conferência é feita no back-end; a tela só mostra o aviso.
"""

from fastapi import HTTPException

from lib.db import db
from models.org import DEFAULT_PLAN_LIMITS, PLAN_LABELS

_SETTINGS_ID = "limits"
_FIELDS = ("users", "products", "history_months", "full_report", "branding")

UPGRADE_HINT = "Para liberar mais, mude de plano em Minha assinatura."


async def get_plan_limits() -> dict[str, dict]:
    doc = await db.platform_settings.find_one({"id": _SETTINGS_ID})
    stored = (doc or {}).get("limits") or {}
    merged: dict[str, dict] = {}
    for plan, defaults in DEFAULT_PLAN_LIMITS.items():
        custom = stored.get(plan) or {}
        merged[plan] = {field: custom.get(field, defaults[field]) for field in _FIELDS}
    return merged


async def set_plan_limits(limits: dict[str, dict]) -> dict[str, dict]:
    current = await get_plan_limits()
    for plan, values in limits.items():
        if plan in current:
            current[plan] = {field: values.get(field, current[plan][field]) for field in _FIELDS}
    await db.platform_settings.update_one(
        {"id": _SETTINGS_ID}, {"$set": {"limits": current}}, upsert=True
    )
    return current


async def limits_for_org(org: dict | None) -> dict:
    """Effective limits for one company: its plan's limits + its own extras."""
    plan = (org or {}).get("plan", "TESTE")
    limits = dict((await get_plan_limits()).get(plan) or DEFAULT_PLAN_LIMITS["TESTE"])
    extra = (org or {}).get("limit_overrides") or {}
    if limits["users"] is not None:
        limits["users"] += int(extra.get("extra_users", 0))
    if limits["products"] is not None:
        limits["products"] += int(extra.get("extra_products", 0))
    return limits


async def _org(org_id: str) -> dict:
    return await db.organizations.find_one({"id": org_id}) or {}


async def usage_for_org(org_id: str) -> dict[str, int]:
    return {
        "users": await db.users.count_documents({"org_id": org_id}),
        "products": await db.products.count_documents({"org_id": org_id}),
    }


async def ensure_can_add(org_id: str, resource: str, label: str) -> None:
    """403 when adding one more `resource` ("users" | "products") passes the plan limit."""
    org = await _org(org_id)
    limit = (await limits_for_org(org)).get(resource)
    if limit is None:
        return
    used = await db[resource].count_documents({"org_id": org_id})
    if used >= limit:
        plan = PLAN_LABELS.get(org.get("plan", ""), org.get("plan", ""))
        raise HTTPException(
            status_code=403,
            detail=f"Seu plano {plan} permite até {limit} {label}. {UPGRADE_HINT}",
            headers={"X-Plan-Limit": resource},
        )


async def plan_allows(org_id: str, feature: str) -> bool:
    """Feature flags: "full_report" | "branding"."""
    return bool((await limits_for_org(await _org(org_id))).get(feature, True))


async def history_months(org_id: str) -> int | None:
    return (await limits_for_org(await _org(org_id))).get("history_months")
