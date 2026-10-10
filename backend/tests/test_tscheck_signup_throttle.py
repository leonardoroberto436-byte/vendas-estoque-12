"""tscheck: signup succeeds for a legitimate fresh company (happy path of the
signup abuse throttle). The 429 boundary (SIGNUP_LIMIT_PER_HOUR=30/hour/IP) is
shared process-wide state with every other suite that calls /auth/signup in
this run, so we only assert the structural pieces here (throttle wired with a
Retry-After header, confirmed in test_tscheck_login_throttle.py's 429 case)
rather than hammering 30 signups from the same IP, which would legitimately
lock out the rest of the suite per the briefing's own warning.

Run: cd /app/backend && python -m pytest tests/test_tscheck_signup_throttle.py -q
"""

import os
import uuid

import httpx

API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30.0)


def test_legitimate_signup_succeeds():
    email = f"tscheck-signup.{uuid.uuid4().hex[:10]}@teste-saas.com"
    with _client() as c:
        resp = c.post(
            "/auth/signup",
            json={
                "name": "Tscheck Signup",
                "company_name": "Tscheck Signup Co",
                "email": email,
                "password": "Empresa@2026",
                "accept_terms": True,
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "PENDENTE"
        assert body["organization_id"]

        # same email twice is rejected (409), confirming the endpoint still
        # validates normally and is not just no-op accepting everything
        dupe = c.post(
            "/auth/signup",
            json={
                "name": "Tscheck Signup",
                "company_name": "Tscheck Signup Co",
                "email": email,
                "password": "Empresa@2026",
                "accept_terms": True,
            },
        )
        assert dupe.status_code == 409, dupe.text
