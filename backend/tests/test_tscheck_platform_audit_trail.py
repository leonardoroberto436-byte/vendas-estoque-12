"""tscheck: platform owner audit trail records every owner action, RBAC + anon.

Uses a throwaway organization created via self-signup (no DELETE /platform
/organizations endpoint exists, so it is left for the main agent's cleanup --
same convention as test_tscheck_operator_write_blocked.py) to exercise status
change, plan/due-date change, company edit and admin-password reset without
touching the real 'Minha Loja' company or its real admin login. Plan-price
edits and backups are global, so the price edit is reverted immediately after
asserting the log entry.

Run: cd /app/backend && python -m pytest tests/test_tscheck_platform_audit_trail.py -q
"""

import os
import uuid

import httpx

from tests.credentials import env
import pytest



API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"

PLATFORM_EMAIL = env("PLATFORM_OWNER_EMAIL")
PLATFORM_PASSWORD = env("PLATFORM_OWNER_PASSWORD")
ADMIN_EMAIL = env("COMPANY_ADMIN_EMAIL")
ADMIN_PASSWORD = env("COMPANY_ADMIN_PASSWORD")
SIGNUP_PASSWORD = "Empresa@2026"


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30.0)


def _login(email: str, password: str) -> httpx.Client:
    c = _client()
    resp = c.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return c


@pytest.fixture
def owner():
    c = _login(PLATFORM_EMAIL, PLATFORM_PASSWORD)
    yield c
    c.close()


@pytest.fixture
def throwaway_org(owner):
    suffix = uuid.uuid4().hex[:8]
    email = f"tscheck-audit.{suffix}@auditoria-exemplo.com"
    with _client() as c:
        resp = c.post(
            "/auth/signup",
            json={
                "name": f"Dono tscheck {suffix}",
                "company_name": f"Tscheck Audit {suffix}",
                "email": email,
                "password": SIGNUP_PASSWORD,
                "accept_terms": True,
            },
        )
    assert resp.status_code == 201, resp.text
    yield {"org_id": resp.json()["organization_id"], "name": f"Tscheck Audit {suffix}", "email": email}


def _latest_action(owner, action: str, target: str) -> dict:
    resp = owner.get("/platform/logs", params={"limit": 50})
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    for row in rows:
        if row["action"] == action and target in row["target"]:
            return row
    raise AssertionError(f"no log row for action={action} target~={target} in {rows[:5]}")


def test_owner_actions_are_logged(owner, throwaway_org):
    org_id = throwaway_org["org_id"]
    org_name = throwaway_org["name"]

    # 1) status change
    r = owner.put(f"/platform/organizations/{org_id}/status", json={"status": "APROVADA"})
    assert r.status_code == 200, r.text
    row = _latest_action(owner, "STATUS_APROVADA", org_name)
    assert row["actor_email"] == PLATFORM_EMAIL

    # 2) plan/due-date change
    r = owner.put(
        f"/platform/organizations/{org_id}/plan",
        json={"plan": "INICIAL", "subscription_status": "ATIVO", "due_date": "2026-12-01"},
    )
    assert r.status_code == 200, r.text
    row = _latest_action(owner, "PLANO_ALTERADO", org_name)
    assert "INICIAL" in row["details"]

    # 3) company edit
    r = owner.put(
        f"/platform/organizations/{org_id}",
        json={
            "name": org_name,
            "owner_name": "Dono Editado Tscheck",
            "owner_email": throwaway_org["email"],
        },
    )
    assert r.status_code == 200, r.text
    row = _latest_action(owner, "EMPRESA_EDITADA", org_name)
    assert "Dono Editado Tscheck" in row["details"]

    # 4) reset company admin password
    r = owner.post(f"/platform/organizations/{org_id}/admin-password")
    assert r.status_code == 200, r.text
    row = _latest_action(owner, "SENHA_ADMIN_REDEFINIDA", org_name)
    assert row["actor_email"] == PLATFORM_EMAIL

    # 5) run backup
    r = owner.post("/platform/backups/run")
    assert r.status_code == 200, r.text
    row = _latest_action(owner, "BACKUP_MANUAL", "")
    assert row["actor_email"] == PLATFORM_EMAIL

    # 6) edit plan prices (global) -- revert immediately after asserting the log
    current = owner.get("/platform/plan-prices")
    assert current.status_code == 200
    original_prices = current.json()["prices"]
    nudged = dict(original_prices)
    basico_key = "BASICO" if "BASICO" in nudged else next(iter(nudged))
    nudged[basico_key] = round(nudged[basico_key] + 0.01, 2)
    try:
        r = owner.put("/platform/plan-prices", json={"prices": nudged})
        assert r.status_code == 200, r.text
        row = _latest_action(owner, "PRECOS_ALTERADOS", "planos")
        assert row["actor_email"] == PLATFORM_EMAIL
    finally:
        restore = owner.put("/platform/plan-prices", json={"prices": original_prices})
        assert restore.status_code == 200, restore.text

    # newest first ordering holds across all the above
    resp = owner.get("/platform/logs", params={"limit": 10})
    created_times = [row["created_at"] for row in resp.json()]
    assert created_times == sorted(created_times, reverse=True)


def test_logs_are_owner_only():
    admin = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    try:
        assert admin.get("/platform/logs").status_code == 403

        suffix = uuid.uuid4().hex[:8]
        op_email = f"tscheck-audit-op.{suffix}@auditoria-exemplo.com"
        created = admin.post(
            "/users",
            json={
                "name": "Tscheck Audit Operador",
                "email": op_email,
                "password": SIGNUP_PASSWORD,
                "accept_terms": True,
                "role": "OPERADOR",
                "is_active": True,
            },
        )
        assert created.status_code == 201, created.text
        op_id = created.json()["id"]
        op = _login(op_email, SIGNUP_PASSWORD)
        try:
            assert op.get("/platform/logs").status_code == 403
        finally:
            op.close()
            admin.delete(f"/users/{op_id}")
    finally:
        admin.close()

    with _client() as anon:
        assert anon.get("/platform/logs").status_code == 401
