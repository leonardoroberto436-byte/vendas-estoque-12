"""Platform owner area — mounted under /api/platform.

Every route requires the `platform:manage` permission, which only
PLATFORM_OWNER has. A customer's ADMIN has `users:manage` but NOT
`platform:manage`, so this whole module is closed to them (403).

This is also the only module allowed to read across organizations.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import ROLE_ADMIN, hash_password, require
from lib.db import db
from lib.email import send_org_approved
from lib.subscriptions import (
    PAYING_STATUSES,
    days_until,
    get_plan_prices,
    run_due_reminders,
    set_plan_prices,
)
from models.org import (
    DEFAULT_PLAN_PRICES,
    PLAN_LABELS,
    TRIAL_DAYS,
    OrgCreateRequest,
    OrgCredentials,
    OrgPlanUpdate,
    OrgStatusUpdate,
    OrgUpdateRequest,
    Organization,
    PlanPrices,
    PlanRevenue,
    PlatformOrgView,
    PlatformRevenue,
    PlatformStats,
    PlatformUserView,
)
from models.users import User

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/platform",
    tags=["platform"],
    dependencies=[Depends(require("platform:manage"))],
)


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _to_view(org: dict) -> PlatformOrgView:
    org_filter = {"org_id": org["id"]}
    trial_ends = _aware(org.get("trial_ends_at"))
    days_left = None
    if trial_ends:
        days_left = max(0, (trial_ends - datetime.now(timezone.utc)).days)

    last_sale = await db.sales.find_one(org_filter, sort=[("created_at", -1)])
    return PlatformOrgView(
        id=org["id"],
        name=org["name"],
        status=org["status"],
        plan=org["plan"],
        plan_label=PLAN_LABELS.get(org["plan"], org["plan"]),
        subscription_status=org["subscription_status"],
        trial_ends_at=trial_ends,
        trial_days_left=days_left,
        due_date=_aware(org.get("due_date")),
        days_to_due=days_until(org.get("due_date")),
        owner_name=org.get("owner_name", ""),
        owner_email=org.get("owner_email", ""),
        created_at=_aware(org["created_at"]),
        approved_at=_aware(org.get("approved_at")),
        suspended_at=_aware(org.get("suspended_at")),
        user_count=await db.users.count_documents(org_filter),
        product_count=await db.products.count_documents(org_filter),
        sales_count=await db.sales.count_documents(org_filter),
        last_activity_at=_aware(last_sale["created_at"]) if last_sale else None,
    )


def _generate_password() -> str:
    """Readable temporary password — shown once to the owner, never stored in clear."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10)) + "@2026"


@router.post("/organizations", response_model=OrgCredentials, status_code=201)
async def create_organization(payload: OrgCreateRequest):
    """Owner registers a customer company and its ADMIN in one step.

    The company is born APROVADA (the owner is the one approving it) with its own
    org_id, so every row it creates from now on lives in an isolated workspace.
    """
    email = payload.owner_email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.")
    if await db.organizations.find_one({"name": payload.company_name.strip()}):
        raise HTTPException(status_code=409, detail="Já existe uma empresa com este nome.")

    now = datetime.now(timezone.utc)
    org = Organization(
        name=payload.company_name.strip(),
        owner_name=payload.owner_name.strip(),
        owner_email=email,
        status="APROVADA",
        plan=payload.plan,
        subscription_status=payload.subscription_status,
        trial_ends_at=now + timedelta(days=TRIAL_DAYS) if payload.plan == "TESTE" else None,
        approved_at=now,
    )
    await db.organizations.insert_one(org.model_dump())

    password = _generate_password()
    admin = User(
        name=payload.owner_name.strip(),
        email=email,
        role=ROLE_ADMIN,
        org_id=org.id,
        is_active=True,
    )
    doc = admin.model_dump()
    doc["password_hash"] = hash_password(password)
    await db.users.insert_one(doc)

    email_sent = False
    if payload.send_email:
        try:
            await send_org_approved(
                to=email, name=admin.name, company=org.name, trial_days=TRIAL_DAYS
            )
            email_sent = True
        except HTTPException as exc:
            logger.warning("Welcome email não enviado para %s: %s", email, exc.detail)

    created = await db.organizations.find_one({"id": org.id})
    return OrgCredentials(
        organization=await _to_view(created),
        admin_email=email,
        admin_password=password,
        email_sent=email_sent,
        message=(
            "Empresa criada e liberada. Repasse o e-mail e a senha abaixo ao cliente — "
            "esta senha só aparece agora."
        ),
    )


@router.put("/organizations/{org_id}", response_model=PlatformOrgView)
async def update_organization(org_id: str, payload: OrgUpdateRequest):
    """Edit company name and responsible person. The admin login follows the e-mail."""
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    email = payload.owner_email.strip().lower()
    clash = await db.users.find_one({"email": email, "org_id": {"$ne": org_id}})
    if clash:
        raise HTTPException(status_code=409, detail="Este e-mail já é usado por outra conta.")

    await db.organizations.update_one(
        {"id": org_id},
        {
            "$set": {
                "name": payload.name.strip(),
                "owner_name": payload.owner_name.strip(),
                "owner_email": email,
            }
        },
    )
    # keep the company's admin account in sync with the responsible person
    admin = await db.users.find_one({"org_id": org_id, "email": org.get("owner_email", "")})
    if admin:
        await db.users.update_one(
            {"id": admin["id"]},
            {"$set": {"name": payload.owner_name.strip(), "email": email}},
        )

    updated = await db.organizations.find_one({"id": org_id})
    return await _to_view(updated)


@router.post("/organizations/{org_id}/admin-password", response_model=OrgCredentials)
async def reset_org_admin(org_id: str):
    """Generate a fresh password for the company's admin (creating the account if missing)."""
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    email = (org.get("owner_email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Empresa sem e-mail de responsável.")

    password = _generate_password()
    admin = await db.users.find_one({"org_id": org_id, "email": email})
    if admin:
        await db.users.update_one(
            {"id": admin["id"]},
            {"$set": {"password_hash": hash_password(password), "is_active": True}},
        )
        await db.sessions.delete_many({"user_id": admin["id"]})
    else:
        new_admin = User(
            name=org.get("owner_name", "Administrador"),
            email=email,
            role=ROLE_ADMIN,
            org_id=org_id,
            is_active=True,
        )
        doc = new_admin.model_dump()
        doc["password_hash"] = hash_password(password)
        await db.users.insert_one(doc)

    return OrgCredentials(
        organization=await _to_view(org),
        admin_email=email,
        admin_password=password,
        email_sent=False,
        message="Nova senha gerada. As sessões anteriores desse administrador foram encerradas.",
    )


@router.get("/stats", response_model=PlatformStats)
async def platform_stats():
    orgs = await db.organizations.find().sort("created_at", -1).to_list(2000)
    by_plan: dict[str, int] = {}
    by_subscription: dict[str, int] = {}
    for org in orgs:
        by_plan[org["plan"]] = by_plan.get(org["plan"], 0) + 1
        key = org["subscription_status"]
        by_subscription[key] = by_subscription.get(key, 0) + 1

    recent = [await _to_view(org) for org in orgs[:5]]
    return PlatformStats(
        total_orgs=len(orgs),
        pending_orgs=sum(1 for o in orgs if o["status"] == "PENDENTE"),
        approved_orgs=sum(1 for o in orgs if o["status"] == "APROVADA"),
        suspended_orgs=sum(1 for o in orgs if o["status"] == "SUSPENSA"),
        total_users=await db.users.count_documents({"role": {"$ne": "PLATFORM_OWNER"}}),
        by_plan=by_plan,
        by_subscription=by_subscription,
        recent_orgs=recent,
    )


@router.get("/organizations", response_model=List[PlatformOrgView])
async def list_organizations():
    orgs = await db.organizations.find().sort("created_at", -1).to_list(2000)
    return [await _to_view(org) for org in orgs]


@router.get("/users", response_model=List[PlatformUserView])
async def list_all_users():
    users = await db.users.find().sort("created_at", -1).to_list(5000)
    orgs = await db.organizations.find({}, {"id": 1, "name": 1}).to_list(2000)
    names = {o["id"]: o["name"] for o in orgs}
    return [
        PlatformUserView(
            id=u["id"],
            name=u["name"],
            email=u["email"],
            role=u["role"],
            is_active=u.get("is_active", False),
            org_id=u.get("org_id"),
            org_name=names.get(u.get("org_id") or "", "— plataforma —"),
            created_at=_aware(u["created_at"]),
            last_login_at=_aware(u.get("last_login_at")),
        )
        for u in users
    ]


@router.put("/organizations/{org_id}/status", response_model=PlatformOrgView)
async def set_org_status(org_id: str, payload: OrgStatusUpdate):
    """Approve a pending signup, suspend an abusive/unpaid company, or reactivate it."""
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    now = datetime.now(timezone.utc)
    changes: dict = {"status": payload.status}
    newly_approved = payload.status == "APROVADA" and org["status"] != "APROVADA"

    if newly_approved:
        changes["approved_at"] = now
        changes["suspended_at"] = None
        if not org.get("trial_ends_at"):
            changes["trial_ends_at"] = now + timedelta(days=TRIAL_DAYS)
            changes["subscription_status"] = "TESTE"
            changes["plan"] = "TESTE"
    if payload.status == "SUSPENSA":
        changes["suspended_at"] = now
        # revoke live sessions of that company immediately
        members = await db.users.find({"org_id": org_id}, {"id": 1}).to_list(5000)
        if members:
            await db.sessions.delete_many({"user_id": {"$in": [m["id"] for m in members]}})

    await db.organizations.update_one({"id": org_id}, {"$set": changes})

    if newly_approved and org.get("owner_email"):
        try:
            await send_org_approved(
                to=org["owner_email"],
                name=org.get("owner_name", ""),
                company=org["name"],
                trial_days=TRIAL_DAYS,
            )
        except HTTPException as exc:
            logger.warning("Approval email não enviado para %s: %s", org["owner_email"], exc.detail)

    updated = await db.organizations.find_one({"id": org_id})
    return await _to_view(updated)


@router.put("/organizations/{org_id}/plan", response_model=PlatformOrgView)
async def set_org_plan(org_id: str, payload: OrgPlanUpdate):
    """Plan + subscription state only. No charge is made here — billing comes later."""
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    changes: dict = {
        "plan": payload.plan,
        "subscription_status": payload.subscription_status,
    }
    if payload.due_date is None:
        changes["due_date"] = None
    else:
        try:
            # noon UTC keeps the date stable when read back in America/Sao_Paulo
            changes["due_date"] = datetime.fromisoformat(payload.due_date).replace(
                hour=12, minute=0, tzinfo=timezone.utc
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Data de vencimento inválida.")
        # a new due date starts a fresh reminder cycle
        changes["reminders_sent"] = []
    await db.organizations.update_one({"id": org_id}, {"$set": changes})

    if payload.subscription_status == "CANCELADO":
        members = await db.users.find({"org_id": org_id}, {"id": 1}).to_list(5000)
        if members:
            await db.sessions.delete_many({"user_id": {"$in": [m["id"] for m in members]}})

    updated = await db.organizations.find_one({"id": org_id})
    return await _to_view(updated)


# --------------------------------------------------------------- revenue (MRR)
@router.get("/plan-prices", response_model=PlanPrices)
async def read_plan_prices():
    return PlanPrices(prices=await get_plan_prices())


@router.put("/plan-prices", response_model=PlanPrices)
async def write_plan_prices(payload: PlanPrices):
    unknown = set(payload.prices) - set(DEFAULT_PLAN_PRICES)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Plano desconhecido: {', '.join(unknown)}")
    return PlanPrices(prices=await set_plan_prices(payload.prices))


@router.get("/revenue", response_model=PlatformRevenue)
async def platform_revenue():
    """Recurring revenue: what is actually billable today versus what is late.

    `mrr` counts only ATIVO companies. INADIMPLENTE companies still owe, so
    their value lands in `overdue_amount`; `expected_mrr` is the two combined.
    """
    prices = await get_plan_prices()
    orgs = await db.organizations.find({"status": "APROVADA"}).to_list(5000)

    rows: list[PlanRevenue] = []
    mrr = overdue = 0.0
    paying = trials = 0
    for plan, price in prices.items():
        in_plan = [o for o in orgs if o.get("plan") == plan]
        billable = [o for o in in_plan if o.get("subscription_status") in PAYING_STATUSES]
        active = [o for o in billable if o.get("subscription_status") == "ATIVO"]
        late = [o for o in billable if o.get("subscription_status") == "INADIMPLENTE"]
        mrr += price * len(active)
        overdue += price * len(late)
        paying += len(billable)
        if plan == "TESTE":
            trials += len(in_plan)
        rows.append(
            PlanRevenue(
                plan=plan,  # type: ignore[arg-type]
                plan_label=PLAN_LABELS.get(plan, plan),
                price=price,
                paying_orgs=len(billable),
                total_orgs=len(in_plan),
                monthly_revenue=round(price * len(billable), 2),
            )
        )

    return PlatformRevenue(
        mrr=round(mrr, 2),
        expected_mrr=round(mrr + overdue, 2),
        overdue_amount=round(overdue, 2),
        paying_orgs=paying,
        trial_orgs=trials,
        by_plan=rows,
    )


@router.post("/run-due-reminders")
async def trigger_due_reminders():
    """Manual trigger for the daily reminder job — same code path as the cron."""
    return await run_due_reminders()
