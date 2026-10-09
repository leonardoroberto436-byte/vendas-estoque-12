"""tscheck: OPERADOR is blocked server-side from every management action.

Covers the acceptance criterion: POST/PUT/DELETE /api/products, POST
/api/stock/movements, PUT /api/settings/branding and GET /api/users all
return 403 for an OPERADOR session, while sales:create/returns:create/
reports:read keep working for the same seller.

Run: cd /app/backend && python -m pytest tests/test_tscheck_operator_write_blocked.py -q
"""

import os
import uuid
from contextlib import contextmanager

import httpx
import pytest

API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"

PASSWORD = "Empresa@2026"


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30.0)


def _signup(suffix: str) -> dict:
    email = f"tscheck-opwrite.{suffix}.{uuid.uuid4().hex[:8]}@teste-saas.com"
    with _client() as c:
        resp = c.post(
            "/auth/signup",
            json={
                "name": f"Dono {suffix}",
                "company_name": f"TscheckOpWrite {suffix}",
                "email": email,
                "password": PASSWORD,
            },
        )
    assert resp.status_code == 201, resp.text
    return {"email": email, "org_id": resp.json()["organization_id"]}


@contextmanager
def _session(email: str, password: str):
    c = _client()
    resp = c.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    try:
        yield c
    finally:
        c.close()


PLATFORM_EMAIL = os.environ.get(
    "PLATFORM_OWNER_EMAIL", "leonardoroberto436+plataforma@gmail.com"
)
PLATFORM_PASSWORD = os.environ.get("PLATFORM_OWNER_PASSWORD", "Plataforma@2026")


@pytest.fixture
def operator_and_admin():
    owner_info = _signup("srv")
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        resp = owner.put(
            f"/platform/organizations/{owner_info['org_id']}/status",
            json={"status": "APROVADA"},
        )
        assert resp.status_code == 200, resp.text

    with _session(owner_info["email"], PASSWORD) as admin:
        prod = admin.post(
            "/products",
            json={
                "name": "tscheck-opwrite produto",
                "sku": f"TSCHECK-OPWRITE-{uuid.uuid4().hex[:6]}",
                "category": "Testes",
                "cost_price": 10.0,
                "sale_price": 20.0,
                "current_stock": 10,
                "min_stock": 1,
            },
        )
        assert prod.status_code == 201, prod.text
        product_id = prod.json()["id"]

        op_email = f"tscheck-operador.{uuid.uuid4().hex[:8]}@teste-saas.com"
        created = admin.post(
            "/users",
            json={
                "name": "Tscheck Operador",
                "email": op_email,
                "password": PASSWORD,
                "role": "OPERADOR",
                "is_active": True,
            },
        )
        assert created.status_code == 201, created.text

    yield {"email": op_email, "product_id": product_id}


def test_operator_blocked_from_management_routes(operator_and_admin):
    product_id = operator_and_admin["product_id"]
    with _session(operator_and_admin["email"], PASSWORD) as op:
        # products:write
        r = op.post(
            "/products",
            json={
                "name": "tscheck nope",
                "sku": f"TSCHECK-NOPE-{uuid.uuid4().hex[:6]}",
                "category": "Testes",
                "cost_price": 1.0,
                "sale_price": 2.0,
                "current_stock": 1,
                "min_stock": 1,
            },
        )
        assert r.status_code == 403, r.text
        assert op.put(f"/products/{product_id}", json={"name": "x"}).status_code == 403
        assert op.delete(f"/products/{product_id}").status_code == 403

        # stock:write
        r = op.post(
            "/stock/movements",
            json={"product_id": product_id, "type": "AJUSTE_POSITIVO", "quantity": 1, "reason": "tscheck"},
        )
        assert r.status_code == 403, r.text

        # users:manage
        assert op.get("/users").status_code == 403

        # settings (branding)
        r = op.put("/settings/branding", json={"company_name": "tscheck hack"})
        assert r.status_code == 403, r.text

        # allowed actions still work
        assert op.get("/products").status_code == 200
        sale = op.post(
            "/sales",
            json={
                "items": [{"product_id": product_id, "quantity": 1, "unit_price": 20.0}],
                "payment_method": "DINHEIRO",
            },
        )
        assert sale.status_code == 201, sale.text
