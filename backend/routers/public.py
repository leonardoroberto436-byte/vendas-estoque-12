"""Dados públicos da página de vendas — /api/public (sem login).

Preços, limites e dias de teste vêm do mesmo lugar que o sistema usa para
cobrar, então a página de vendas nunca mostra um valor diferente do cobrado.
"""

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from lib.billing import founder_slots_left
from lib.plans import get_plan_limits
from lib.subscriptions import get_plan_prices
from models.org import FOUNDER_COUPON, FOUNDER_DISCOUNT, PAID_PLANS, PLAN_LABELS, TRIAL_DAYS

router = APIRouter(prefix="/public", tags=["public"])


class PublicPlan(BaseModel):
    id: str
    label: str
    price: float
    users: Optional[int] = None
    products: Optional[int] = None
    history_months: Optional[int] = None
    full_report: bool = True
    branding: bool = True


class PublicPlans(BaseModel):
    trial_days: int
    plans: list[PublicPlan]
    founder_coupon: str
    founder_discount: float
    founder_slots_left: int


@router.get("/plans", response_model=PublicPlans)
async def public_plans():
    prices = await get_plan_prices()
    limits = await get_plan_limits()
    plans = [
        PublicPlan(id=plan, label=PLAN_LABELS[plan], price=prices.get(plan, 0.0), **(limits.get(plan) or {}))
        for plan in PAID_PLANS
    ]
    return PublicPlans(
        trial_days=TRIAL_DAYS,
        plans=plans,
        founder_coupon=FOUNDER_COUPON,
        founder_discount=FOUNDER_DISCOUNT,
        founder_slots_left=await founder_slots_left(),
    )
