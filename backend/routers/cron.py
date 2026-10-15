"""Platform cron webhooks — mounted under /api/cron.

Authenticated by a shared secret in WEBHOOK_CRON_SECRET, never by a session.
The handler acks immediately and does the real work in the background.
"""

import hmac
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException

from lib.backups import run_backup
from lib.db import db
from lib.billing import run_billing_daily
from lib.subscriptions import run_due_reminders

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cron", tags=["cron"])

_seen_runs: set[str] = set()


def _check_auth(authorization: str | None) -> None:
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not secret or not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Não autorizado")
    if not hmac.compare_digest(authorization.removeprefix("Bearer ").strip(), secret):
        raise HTTPException(status_code=401, detail="Não autorizado")


@router.post("/subscription-reminders")
async def subscription_reminders(
    background: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_webhook_id: str | None = Header(default=None),
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _check_auth(authorization)
    run_id = x_webhook_id or ""
    if run_id and run_id in _seen_runs:
        return {"status": "duplicate", "run_id": run_id}
    if run_id:
        _seen_runs.add(run_id)
        if len(_seen_runs) > 500:
            _seen_runs.clear()
    background.add_task(run_due_reminders)
    background.add_task(run_billing_daily)  # tolerância, suspensão e fim do teste
    return {"status": "accepted", "run_id": run_id}


@router.post("/backup")
async def nightly_backup(
    background: BackgroundTasks,
    authorization: str | None = Header(default=None),
    x_webhook_id: str | None = Header(default=None),
    if_missing: bool = False,
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _check_auth(authorization)
    run_id = x_webhook_id or ""
    if run_id and run_id in _seen_runs:
        return {"status": "duplicate", "run_id": run_id}
    if run_id:
        _seen_runs.add(run_id)
    if if_missing:
        # repescagem: só roda se não houver backup OK nas últimas 20 horas
        since = datetime.now(timezone.utc) - timedelta(hours=20)
        if await db.backups.find_one({"status": "OK", "created_at": {"$gte": since}}):
            return {"status": "skipped", "reason": "já existe backup recente"}
    background.add_task(run_backup)
    return {"status": "accepted", "run_id": run_id}
