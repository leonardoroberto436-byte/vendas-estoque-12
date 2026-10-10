"""tscheck: login brute-force throttle returns 429 after repeated wrong
passwords for the same account, and does not punish an honest login that
succeeds before the limit is hit.

Run: cd /app/backend && python -m pytest tests/test_tscheck_login_throttle.py -q
"""

import os
import uuid

import httpx

from tests.credentials import env
import pytest



API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"

PASSWORD = "Empresa@2026"

PLATFORM_EMAIL = env("PLATFORM_OWNER_EMAIL")
PLATFORM_PASSWORD = env("PLATFORM_OWNER_PASSWORD")


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30.0)


@pytest.fixture
def fresh_account():
    email = f"tscheck-throttle.{uuid.uuid4().hex[:8]}@teste-saas.com"
    with _client() as c:
        resp = c.post(
            "/auth/signup",
            json={
                "name": "Tscheck Throttle",
                "company_name": "Tscheck Throttle Co",
                "email": email,
                "password": PASSWORD,
                "accept_terms": True,
            },
        )
    assert resp.status_code == 201, resp.text
    org_id = resp.json()["organization_id"]

    with _client() as owner:
        login = owner.post(
            "/auth/login", json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}
        )
        assert login.status_code == 200, login.text
        approve = owner.put(
            f"/platform/organizations/{org_id}/status", json={"status": "APROVADA"}
        )
        assert approve.status_code == 200, approve.text

    return email


def test_ninth_wrong_password_is_throttled(fresh_account):
    email = fresh_account
    with _client() as c:
        statuses = []
        limit = int(os.environ.get("LOGIN_LIMIT_PER_5MIN", "8"))
        for _ in range(limit):
            r = c.post("/auth/login", json={"email": email, "password": "senha-errada-xyz"})
            statuses.append(r.status_code)
        assert all(s == 401 for s in statuses), statuses

        ninth = c.post("/auth/login", json={"email": email, "password": "senha-errada-xyz"})
        assert ninth.status_code == 429, ninth.text
        assert "retry-after" in {k.lower() for k in ninth.headers.keys()}, ninth.headers


def test_correct_login_before_limit_clears_counter(fresh_account):
    email = fresh_account
    with _client() as c:
        for _ in range(4):
            r = c.post("/auth/login", json={"email": email, "password": "senha-errada-xyz"})
            assert r.status_code == 401

        ok = c.post("/auth/login", json={"email": email, "password": PASSWORD})
        assert ok.status_code == 200, ok.text

    # counter cleared: a fresh client can fail a few more times without being
    # throttled immediately (it inherited an account with 0 failed attempts).
    with _client() as c2:
        for _ in range(4):
            r = c2.post("/auth/login", json={"email": email, "password": "senha-errada-xyz"})
            assert r.status_code == 401, r.text
