"""Platform owner area — mounted under /api/platform.

Every route requires the `platform:manage` permission, which only
PLATFORM_OWNER has. A customer's ADMIN has `users:manage` but NOT
`platform:manage`, so this whole module is closed to them (403).

This is also the only module allowed to read across organizations.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require
from lib.db import db
from lib.email import send_org_approved
from models.org import (
    PLAN_LABELS,
    TRIAL_DAYS,
    OrgPlanUpdate,
    OrgStatusUpdate,
    PlatformOrgView,
    PlatformStats,
    PlatformUserView,
)

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

    changes = {"plan": payload.plan, "subscription_status": payload.subscription_status}
    await db.organizations.update_one({"id": org_id}, {"$set": changes})

    if payload.subscription_status == "CANCELADO":
        members = await db.users.find({"org_id": org_id}, {"id": 1}).to_list(5000)
        if members:
            await db.sessions.delete_many({"user_id": {"$in": [m["id"] for m in members]}})

    updated = await db.organizations.find_one({"id": org_id})
    return await _to_view(updated)
