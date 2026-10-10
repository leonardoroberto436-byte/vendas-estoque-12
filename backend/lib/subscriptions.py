"""Subscription pricing + due-date reminders.

Prices live in a single `platform_settings` document so the platform owner can
change them at runtime. Reminders are sent by the daily cron (see
routers/cron.py) and deduped per company per due date.
"""

import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from lib.db import db
from lib.email import send_due_reminder
from models.org import DEFAULT_PLAN_PRICES, PLAN_LABELS, REMINDER_DAYS

logger = logging.getLogger(__name__)
_SETTINGS_ID = "plans"
APP_TZ = ZoneInfo("America/Sao_Paulo")

# Subscriptions that are actually being charged.
PAYING_STATUSES = ("ATIVO", "INADIMPLENTE")


def aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def days_until(due: datetime | None) -> int | None:
    """Whole days from today (America/Sao_Paulo) to the due date. Negative = late."""
    due = aware(due)
    if not due:
        return None
    today = datetime.now(APP_TZ).date()
    return (due.astimezone(APP_TZ).date() - today).days


async def get_plan_prices() -> dict[str, float]:
    doc = await db.platform_settings.find_one({"id": _SETTINGS_ID})
    stored = (doc or {}).get("prices") or {}
    return {plan: float(stored.get(plan, default)) for plan, default in DEFAULT_PLAN_PRICES.items()}


async def set_plan_prices(prices: dict[str, float]) -> dict[str, float]:
    current = await get_plan_prices()
    for plan, value in prices.items():
        if plan in current:
            current[plan] = round(max(0.0, float(value)), 2)
    await db.platform_settings.update_one(
        {"id": _SETTINGS_ID}, {"$set": {"prices": current}}, upsert=True
    )
    return current


async def run_due_reminders() -> dict:
    """Email every approved company whose due date is 7/3/1/0 days away.

    One e-mail per company per threshold per due date — the sent markers are
    stored on the organization, so re-running the job the same day is a no-op.
    """
    prices = await get_plan_prices()
    orgs = await db.organizations.find({"status": "APROVADA"}).to_list(5000)
    sent, skipped = 0, 0
    marked_late = await mark_overdue(orgs)

    for org in orgs:
        due = aware(org.get("due_date"))
        left = days_until(due)
        if left is None or left not in REMINDER_DAYS:
            continue
        if org.get("subscription_status") not in PAYING_STATUSES:
            continue
        if (org.get("billing") or {}).get("mp_status") == "authorized":
            continue  # cartão cobrado automaticamente: aviso de vencimento não se aplica
        marker = f"{due.astimezone(APP_TZ).date().isoformat()}:{left}"
        if marker in (org.get("reminders_sent") or []):
            skipped += 1
            continue
        email = (org.get("owner_email") or "").strip()
        if not email:
            continue
        try:
            await send_due_reminder(
                to=email,
                name=org.get("owner_name", ""),
                company=org.get("name", ""),
                days=left,
                due_date=due.astimezone(APP_TZ).strftime("%d/%m/%Y"),
                amount=prices.get(org.get("plan", ""), 0.0),
                plan_label=PLAN_LABELS.get(org.get("plan", ""), ""),
            )
        except Exception as exc:  # noqa: BLE001 — one bad address must not stop the batch
            logger.warning("Aviso de vencimento falhou para %s: %s", email, exc)
            continue
        await db.organizations.update_one(
            {"id": org["id"]}, {"$addToSet": {"reminders_sent": marker}}
        )
        sent += 1

    logger.info(
        "Avisos de vencimento: %s enviados, %s já enviados antes, %s marcadas inadimplentes",
        sent,
        skipped,
        marked_late,
    )
    return {"sent": sent, "skipped": skipped, "checked": len(orgs), "marked_late": marked_late}


async def mark_overdue(orgs: list[dict]) -> int:
    """ATIVO companies whose due date has passed become INADIMPLENTE.

    They keep working (the owner decides when to suspend), but the owner panel
    and the revenue numbers show at once who is late. Paying again is recorded
    by the owner setting a new due date with subscription ATIVO.
    """
    from lib.backups import log_platform_action  # local import: avoids a cycle at startup

    changed = 0
    for org in orgs:
        if org.get("subscription_status") != "ATIVO":
            continue
        if (org.get("billing") or {}).get("mp_status") == "authorized":
            continue  # cobrança automática: quem marca atraso é o Mercado Pago
        left = days_until(org.get("due_date"))
        if left is None or left >= 0:
            continue
        result = await db.organizations.update_one(
            {"id": org["id"], "subscription_status": "ATIVO"},
            {"$set": {"subscription_status": "INADIMPLENTE"}},
        )
        if result.modified_count:
            org["subscription_status"] = "INADIMPLENTE"
            changed += 1
            await log_platform_action(
                actor_email="sistema",
                action="INADIMPLENTE_AUTOMATICO",
                target=org.get("name", ""),
                details=f"vencimento passou há {-left} dia(s)",
            )
    return changed
