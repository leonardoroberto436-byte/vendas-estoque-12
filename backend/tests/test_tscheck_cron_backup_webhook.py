"""tscheck: backup cron webhook is protected by the shared secret + idempotent.

Covers:
 - POST /api/cron/backup without Authorization -> 401
 - with correct Bearer WEBHOOK_CRON_SECRET -> 2xx immediately, status accepted
 - repeating the same X-Webhook-Id -> status duplicate

Run: cd /app/backend && python -m pytest tests/test_tscheck_cron_backup_webhook.py -q
"""

import os
import uuid
from pathlib import Path

import httpx

API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"


def _read_webhook_secret() -> str:
    """WEBHOOK_CRON_SECRET lives only in backend/.env, not in the test process env."""
    if os.environ.get("WEBHOOK_CRON_SECRET"):
        return os.environ["WEBHOOK_CRON_SECRET"]
    env_path = Path(__file__).resolve().parents[1] / ".env"
    for line in env_path.read_text().splitlines():
        if line.startswith("WEBHOOK_CRON_SECRET="):
            return line.split("=", 1)[1].strip()
    return ""


SECRET = _read_webhook_secret()


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30.0)


def test_cron_backup_requires_secret():
    with _client() as c:
        resp = c.post("/cron/backup")
        assert resp.status_code == 401, resp.text

        resp = c.post("/cron/backup", headers={"Authorization": "Bearer wrong-secret"})
        assert resp.status_code == 401, resp.text


def test_cron_backup_accepts_and_dedupes_with_valid_secret():
    assert SECRET, "WEBHOOK_CRON_SECRET must be set in backend/.env for this test to run"
    run_id = f"tscheck-{uuid.uuid4().hex[:10]}"
    with _client() as c:
        headers = {"Authorization": f"Bearer {SECRET}", "X-Webhook-Id": run_id}
        first = c.post("/cron/backup", headers=headers)
        assert 200 <= first.status_code < 300, first.text
        assert first.json()["status"] == "accepted", first.text

        second = c.post("/cron/backup", headers=headers)
        assert 200 <= second.status_code < 300, second.text
        assert second.json()["status"] == "duplicate", second.text
