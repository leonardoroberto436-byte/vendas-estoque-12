"""tscheck: boilerplate /api/status endpoints are removed and CORS is locked
down to the app's own origin only.

Run: cd /app/backend && python -m pytest tests/test_tscheck_cors_and_status.py -q
"""

import os

import httpx

API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"

APP_ORIGIN = os.environ.get(
    "APP_ORIGIN", "https://vendas-estoque-12.preview.emergentagent.com"
)


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30.0)


def test_status_endpoint_removed():
    with _client() as c:
        assert c.get("/status").status_code == 404
        assert c.post("/status", json={}).status_code == 404


def test_cors_blocks_malicious_origin_and_allows_app_origin():
    with _client() as c:
        malicious = c.options(
            "/auth/login",
            headers={
                "Origin": "https://site-malicioso.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        malicious_headers = {k.lower(): v for k, v in malicious.headers.items()}
        assert "access-control-allow-origin" not in malicious_headers, malicious_headers

        legit = c.options(
            "/auth/login",
            headers={
                "Origin": APP_ORIGIN,
                "Access-Control-Request-Method": "POST",
            },
        )
        legit_headers = {k.lower(): v for k, v in legit.headers.items()}
        assert legit_headers.get("access-control-allow-origin") == APP_ORIGIN, legit_headers
