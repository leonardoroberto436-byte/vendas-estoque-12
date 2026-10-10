"""tscheck: the leaked passwords were rotated — current env credentials work,
the old leaked ones are dead.

Run: cd /app/backend && python -m pytest tests/test_tscheck_password_rotation.py -q
"""

import os

import httpx

from tests.credentials import env

API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"

PLATFORM_EMAIL = env("PLATFORM_OWNER_EMAIL")
PLATFORM_PASSWORD = env("PLATFORM_OWNER_PASSWORD")
COMPANY_ADMIN_EMAIL = env("COMPANY_ADMIN_EMAIL")
COMPANY_ADMIN_PASSWORD = env("COMPANY_ADMIN_PASSWORD")

# As senhas que vazaram vêm de BLOCKED_PASSWORDS (backend/.env) — nenhuma
# credencial, nem mesmo uma já queimada, fica fixa no repositório.
_LEAKED = [p.strip() for p in os.environ.get("BLOCKED_PASSWORDS", "").split(",") if p.strip()]
LEAKED_OWNER_PASSWORD = _LEAKED[0] if _LEAKED else "senha-vazada-inexistente-1"
LEAKED_ADMIN_PASSWORD = _LEAKED[-1] if _LEAKED else "senha-vazada-inexistente-2"


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30.0)


def test_current_env_credentials_login():
    with _client() as c:
        owner = c.post("/auth/login", json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD})
        assert owner.status_code == 200, owner.text
        assert owner.json()["role"] == "PLATFORM_OWNER"

    with _client() as c:
        admin = c.post(
            "/auth/login", json={"email": COMPANY_ADMIN_EMAIL, "password": COMPANY_ADMIN_PASSWORD}
        )
        assert admin.status_code == 200, admin.text
        assert admin.json()["role"] == "ADMIN"


def test_old_leaked_passwords_are_dead():
    with _client() as c:
        owner = c.post(
            "/auth/login", json={"email": PLATFORM_EMAIL, "password": LEAKED_OWNER_PASSWORD}
        )
        assert owner.status_code == 401, owner.text

    with _client() as c:
        admin = c.post(
            "/auth/login", json={"email": COMPANY_ADMIN_EMAIL, "password": LEAKED_ADMIN_PASSWORD}
        )
        assert admin.status_code == 401, admin.text
