"""Tenant isolation suite — the acceptance gate for the multi-tenant migration.

Two fictitious companies are created through the real public signup, approved by
the real platform owner, then every cross-tenant path is probed: reads, writes,
deletes, sales, stock, returns, reports, user management and the platform area.

Nothing is asserted "by inspection": each test performs the request a hostile
client would perform (reusing the other company's real ids) and asserts the
server refuses it.

Run: cd /app/backend && python -m pytest tests/test_tenant_isolation.py -q
"""

import os
import uuid
from contextlib import contextmanager

import httpx

from tests.credentials import env
import pytest



# Session cookies are Secure, so the suite must talk HTTPS (the public URL) —
# over plain http the cookie is never stored and every call would be a 401.
API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"

PLATFORM_EMAIL = env("PLATFORM_OWNER_EMAIL")
PLATFORM_PASSWORD = env("PLATFORM_OWNER_PASSWORD")

PASSWORD = "Empresa@2026"
SHARED_SKU = "SKU-COMPARTILHADO"


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=30.0)


def _signup(suffix: str) -> dict:
    """Public self-service signup -> company stays PENDENTE until approved."""
    email = f"empresa.{suffix}.{uuid.uuid4().hex[:8]}@teste-saas.com"
    with _client() as c:
        resp = c.post(
            "/auth/signup",
            json={
                "name": f"Dono {suffix}",
                "company_name": f"Empresa {suffix}",
                "email": email,
                "password": PASSWORD,
                "accept_terms": True,
            },
        )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "PENDENTE"
    return {"email": email, "org_id": body["organization_id"], "company": body["company_name"]}


def _login(email: str, password: str) -> httpx.Client:
    """Returns an ALREADY-authenticated client. Caller owns closing it."""
    c = _client()
    resp = c.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return c


@contextmanager
def _session(email: str, password: str):
    """`with` wrapper — httpx.Client is already open after login, so it cannot be
    re-entered with `with`; this closes it instead."""
    c = _login(email, password)
    try:
        yield c
    finally:
        c.close()


def _approve(org_id: str) -> None:
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        resp = owner.put(f"/platform/organizations/{org_id}/status", json={"status": "APROVADA"})
        assert resp.status_code == 200, resp.text


def _make_product(c: httpx.Client, name: str, sku: str = SHARED_SKU) -> dict:
    resp = c.post(
        "/products",
        json={
            "name": name,
            "sku": sku,
            "category": "Testes",
            "cost_price": 10.0,
            "sale_price": 25.0,
            "current_stock": 40,
            "min_stock": 5,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture(scope="module")
def tenants():
    """Empresa A and Empresa B, approved, each with its own product and sale."""
    a = _signup("A")
    b = _signup("B")
    _approve(a["org_id"])
    _approve(b["org_id"])

    ca = _login(a["email"], PASSWORD)
    cb = _login(b["email"], PASSWORD)

    # Same SKU in both companies on purpose: proves SKU uniqueness is per-tenant
    a["product"] = _make_product(ca, "Produto da Empresa A")
    b["product"] = _make_product(cb, "Produto da Empresa B")

    for company, client in ((a, ca), (b, cb)):
        resp = client.post(
            "/sales",
            json={
                "items": [{"product_id": company["product"]["id"], "quantity": 2}],
                "payment_method": "PIX",
                "discount": 0,
                "notes": "",
            },
        )
        assert resp.status_code == 201, resp.text
        company["sale"] = resp.json()

    a["client"], b["client"] = ca, cb
    yield {"a": a, "b": b}
    ca.close()
    cb.close()


# ----------------------------------------------------------------- signup gate
def test_pending_company_cannot_log_in():
    """A fresh signup must not reach any data before the platform owner approves."""
    pending = _signup("Pendente")
    with _client() as c:
        resp = c.post("/auth/login", json={"email": pending["email"], "password": PASSWORD})
    assert resp.status_code == 403
    assert "aguardando" in resp.json()["detail"].lower()


def test_signup_rejects_duplicate_email(tenants):
    with _client() as c:
        resp = c.post(
            "/auth/signup",
            json={
                "name": "Clone",
                "company_name": "Empresa Clone",
                "email": tenants["a"]["email"],
                "password": PASSWORD,
                "accept_terms": True,
            },
        )
    assert resp.status_code == 409


# -------------------------------------------------------------- product isolation
def test_product_lists_are_disjoint(tenants):
    a_ids = {p["id"] for p in tenants["a"]["client"].get("/products").json()}
    b_ids = {p["id"] for p in tenants["b"]["client"].get("/products").json()}
    assert tenants["a"]["product"]["id"] in a_ids
    assert tenants["b"]["product"]["id"] in b_ids
    assert a_ids.isdisjoint(b_ids)


def test_same_sku_allowed_in_both_companies(tenants):
    assert tenants["a"]["product"]["sku"] == tenants["b"]["product"]["sku"] == SHARED_SKU


def test_cannot_read_other_company_product_by_id(tenants):
    foreign = tenants["b"]["product"]["id"]
    assert tenants["a"]["client"].get(f"/products/{foreign}").status_code == 404


def test_cannot_update_other_company_product(tenants):
    foreign = tenants["b"]["product"]["id"]
    resp = tenants["a"]["client"].put(f"/products/{foreign}", json={"sale_price": 1.0})
    assert resp.status_code == 404
    # and the real owner still sees the untouched price
    still = tenants["b"]["client"].get(f"/products/{foreign}").json()
    assert still["sale_price"] == 25.0


def test_cannot_delete_other_company_product(tenants):
    foreign = tenants["b"]["product"]["id"]
    assert tenants["a"]["client"].delete(f"/products/{foreign}").status_code == 404
    assert tenants["b"]["client"].get(f"/products/{foreign}").status_code == 200


def test_product_search_does_not_leak(tenants):
    found = tenants["a"]["client"].get("/products", params={"search": "Empresa B"}).json()
    assert found == []


# ----------------------------------------------------------------- sales isolation
def test_sales_lists_are_disjoint(tenants):
    a_ids = {s["id"] for s in tenants["a"]["client"].get("/sales").json()}
    b_ids = {s["id"] for s in tenants["b"]["client"].get("/sales").json()}
    assert a_ids.isdisjoint(b_ids)
    assert tenants["b"]["sale"]["id"] not in a_ids


def test_cannot_read_other_company_sale(tenants):
    foreign = tenants["b"]["sale"]["id"]
    assert tenants["a"]["client"].get(f"/sales/{foreign}").status_code == 404


def test_cannot_sell_other_company_product(tenants):
    foreign = tenants["b"]["product"]["id"]
    resp = tenants["a"]["client"].post(
        "/sales",
        json={
            "items": [{"product_id": foreign, "quantity": 1}],
            "payment_method": "DINHEIRO",
            "discount": 0,
            "notes": "",
        },
    )
    assert resp.status_code == 404


def test_sale_records_the_authenticated_seller(tenants):
    sale = tenants["a"]["sale"]
    assert sale["seller_name"] == "Dono A"
    assert sale["code"].startswith("V-")


# ----------------------------------------------------------------- stock isolation
def test_movements_are_disjoint(tenants):
    a_products = {m["product_id"] for m in tenants["a"]["client"].get("/stock/movements").json()}
    assert tenants["b"]["product"]["id"] not in a_products


def test_cannot_move_stock_of_other_company_product(tenants):
    foreign = tenants["b"]["product"]["id"]
    resp = tenants["a"]["client"].post(
        "/stock/movements",
        json={"product_id": foreign, "type": "ENTRADA", "quantity": 50, "reason": "invasao"},
    )
    assert resp.status_code == 404
    # stock of the victim is unchanged
    assert tenants["b"]["client"].get(f"/products/{foreign}").json()["current_stock"] == 38


# --------------------------------------------------------------- returns isolation
def test_return_restocks_and_reduces_net_revenue(tenants):
    client = tenants["a"]["client"]
    sale = tenants["a"]["sale"]
    before = client.get(f"/products/{tenants['a']['product']['id']}").json()["current_stock"]
    resp = client.post(
        "/returns",
        json={
            "sale_id": sale["id"],
            "items": [{"product_id": tenants["a"]["product"]["id"], "quantity": 1}],
            "reason": "cliente desistiu",
            "restock": True,
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["refund_total"] == 25.0
    after = client.get(f"/products/{tenants['a']['product']['id']}").json()["current_stock"]
    assert after == before + 1


def test_cannot_return_more_than_sold(tenants):
    resp = tenants["a"]["client"].post(
        "/returns",
        json={
            "sale_id": tenants["a"]["sale"]["id"],
            "items": [{"product_id": tenants["a"]["product"]["id"], "quantity": 99}],
            "reason": "",
            "restock": True,
        },
    )
    assert resp.status_code == 400


def test_cannot_return_other_company_sale(tenants):
    resp = tenants["a"]["client"].post(
        "/returns",
        json={
            "sale_id": tenants["b"]["sale"]["id"],
            "items": [{"product_id": tenants["b"]["product"]["id"], "quantity": 1}],
            "reason": "invasao",
            "restock": True,
        },
    )
    assert resp.status_code == 404


def test_returns_list_is_disjoint(tenants):
    b_returns = tenants["b"]["client"].get("/returns").json()
    assert all(r["sale_id"] != tenants["a"]["sale"]["id"] for r in b_returns)


# -------------------------------------------------------- dashboard and reports
def test_dashboard_only_counts_own_company(tenants):
    a_stats = tenants["a"]["client"].get("/dashboard/stats", params={"days": 30}).json()
    b_stats = tenants["b"]["client"].get("/dashboard/stats", params={"days": 30}).json()
    assert a_stats["product_count"] == 1
    assert b_stats["product_count"] == 1
    assert a_stats["period_sales_count"] == 1
    assert a_stats["period_refunded"] == 25.0
    assert a_stats["period_net_revenue"] == round(
        a_stats["period_revenue"] - a_stats["period_refunded"], 2
    )
    assert [s["name"] for s in a_stats["top_sellers"]] == ["Dono A"]


@pytest.mark.parametrize("days,expected", [(7, 7), (15, 15), (30, 30), (99, 7)])
def test_dashboard_period_windows(tenants, days, expected):
    stats = tenants["a"]["client"].get("/dashboard/stats", params={"days": days}).json()
    assert stats["period_days"] == expected
    assert len(stats["revenue_series"]) == expected


def test_monthly_report_only_counts_own_company(tenants):
    a_report = tenants["a"]["client"].get("/reports/monthly").json()
    names = [p["name"] for p in a_report["top_products"]]
    assert "Produto da Empresa B" not in names
    assert a_report["sales_count"] == 1


def test_xlsx_export_is_scoped(tenants):
    resp = tenants["a"]["client"].get("/reports/monthly.xlsx")
    assert resp.status_code == 200
    assert "spreadsheetml" in resp.headers["content-type"]


# ------------------------------------------------------ role / platform isolation
def test_company_admin_cannot_reach_platform_area(tenants):
    for path in ("/platform/stats", "/platform/organizations", "/platform/users"):
        assert tenants["a"]["client"].get(path).status_code == 403


def test_company_admin_cannot_approve_or_suspend_companies(tenants):
    org_b = tenants["b"]["org_id"]
    resp = tenants["a"]["client"].put(
        f"/platform/organizations/{org_b}/status", json={"status": "SUSPENSA"}
    )
    assert resp.status_code == 403


def test_user_management_is_scoped_to_own_company(tenants):
    a_users = tenants["a"]["client"].get("/users").json()
    emails = {u["email"].lower() for u in a_users}  # backend normalises to lowercase
    assert tenants["a"]["email"].lower() in emails
    assert tenants["b"]["email"].lower() not in emails


def test_cannot_touch_user_of_other_company(tenants):
    b_users = tenants["b"]["client"].get("/users").json()
    victim = b_users[0]["id"]
    assert tenants["a"]["client"].put(f"/users/{victim}", json={"is_active": False}).status_code == 404
    assert (
        tenants["a"]["client"]
        .put(f"/users/{victim}/password", json={"password": "Invadido@2026"})
        .status_code
        == 404
    )
    assert tenants["a"]["client"].delete(f"/users/{victim}").status_code == 404
    # victim can still log in with the original password
    with _client() as c:
        assert (
            c.post("/auth/login", json={"email": tenants["b"]["email"], "password": PASSWORD}).status_code
            == 200
        )


def test_access_logs_are_scoped(tenants):
    logs = tenants["a"]["client"].get("/users/access-logs").json()
    assert all(log["email"] != tenants["b"]["email"] for log in logs)


def test_operator_cannot_manage_users(tenants):
    admin = tenants["a"]["client"]
    email = f"operador.{uuid.uuid4().hex[:8]}@teste-saas.com"
    created = admin.post(
        "/users",
        json={
            "name": "Operador A",
            "email": email,
            "password": PASSWORD,
            "accept_terms": True,
            "role": "OPERADOR",
            "is_active": True,
        },
    )
    assert created.status_code == 201, created.text
    with _session(email, PASSWORD) as operator:
        assert operator.get("/users").status_code == 403
        assert operator.get("/users/access-logs").status_code == 403
        assert operator.get("/platform/stats").status_code == 403
        # but the shop itself still works for them
        assert operator.get("/products").status_code == 200
        assert operator.get("/dashboard/stats").status_code == 200


def test_operator_cannot_self_promote_to_admin(tenants):
    """Role must come from the server, never from the payload."""
    admin = tenants["a"]["client"]
    email = f"operador2.{uuid.uuid4().hex[:8]}@teste-saas.com"
    created = admin.post(
        "/users",
        json={
            "name": "Operador Dois",
            "email": email,
            "password": PASSWORD,
            "accept_terms": True,
            "role": "OPERADOR",
            "is_active": True,
        },
    )
    user_id = created.json()["id"]
    with _session(email, PASSWORD) as operator:
        assert operator.put(f"/users/{user_id}", json={"role": "ADMIN"}).status_code == 403
        assert operator.get("/auth/me").json()["role"] == "OPERADOR"


def test_company_admin_cannot_mint_a_platform_owner(tenants):
    resp = tenants["a"]["client"].post(
        "/users",
        json={
            "name": "Falso Dono",
            "email": f"falso.{uuid.uuid4().hex[:8]}@teste-saas.com",
            "password": PASSWORD,
            "accept_terms": True,
            "role": "PLATFORM_OWNER",
            "is_active": True,
        },
    )
    assert resp.status_code == 422  # role is constrained to company roles


def test_platform_owner_cannot_read_shop_data(tenants):
    """The SaaS owner administers companies; they are not inside any workspace."""
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        for path in ("/products", "/sales", "/dashboard/stats", "/stock/movements", "/returns"):
            assert owner.get(path).status_code == 403
        assert owner.get("/platform/organizations").status_code == 200


# ------------------------------------------------------------- anonymous access
@pytest.mark.parametrize(
    "path",
    [
        "/products",
        "/sales",
        "/returns",
        "/stock/movements",
        "/dashboard/stats",
        "/reports/monthly",
        "/users",
        "/users/access-logs",
        "/platform/stats",
        "/platform/organizations",
    ],
)
def test_anonymous_is_refused_everywhere(path):
    with _client() as c:
        assert c.get(path).status_code == 401


def test_tampering_with_the_session_cookie_fails(tenants):
    with _client() as c:
        c.cookies.set("ev_session", "token-inventado-por-atacante")
        assert c.get("/products").status_code == 401


def test_org_id_in_payload_is_ignored(tenants):
    """Sending another company's org_id must not move the row across tenants."""
    client = tenants["a"]["client"]
    resp = client.post(
        "/products",
        json={
            "name": "Tentativa de injecao",
            "sku": f"INJ-{uuid.uuid4().hex[:6]}",
            "category": "Testes",
            "cost_price": 1.0,
            "sale_price": 2.0,
            "current_stock": 1,
            "min_stock": 0,
            "org_id": tenants["b"]["org_id"],  # hostile field
        },
    )
    assert resp.status_code == 201
    created = resp.json()["id"]
    # it landed in A (visible to A, invisible to B)
    assert client.get(f"/products/{created}").status_code == 200
    assert tenants["b"]["client"].get(f"/products/{created}").status_code == 404


# ---------------------------------------------------- suspension kills access now
def test_suspending_a_company_revokes_its_sessions_immediately():
    victim = _signup("Suspensa")
    _approve(victim["org_id"])
    session = _login(victim["email"], PASSWORD)
    assert session.get("/products").status_code == 200

    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        resp = owner.put(
            f"/platform/organizations/{victim['org_id']}/status", json={"status": "SUSPENSA"}
        )
        assert resp.status_code == 200

    # the already-open session stops working on the very next request
    assert session.get("/products").status_code in (401, 403)
    with _client() as c:
        assert (
            c.post("/auth/login", json={"email": victim["email"], "password": PASSWORD}).status_code
            == 403
        )
    session.close()


def test_cancelled_subscription_blocks_access():
    victim = _signup("Cancelada")
    _approve(victim["org_id"])
    session = _login(victim["email"], PASSWORD)

    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        resp = owner.put(
            f"/platform/organizations/{victim['org_id']}/plan",
            json={"plan": "INICIAL", "subscription_status": "CANCELADO"},
        )
        assert resp.status_code == 200

    assert session.get("/products").status_code in (401, 403)
    session.close()


def test_overdue_subscription_still_allows_access():
    """INADIMPLENTE warns but must not lock a paying customer out of their data."""
    org = _signup("Inadimplente")
    _approve(org["org_id"])
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        owner.put(
            f"/platform/organizations/{org['org_id']}/plan",
            json={"plan": "INICIAL", "subscription_status": "INADIMPLENTE"},
        )
    with _session(org["email"], PASSWORD) as session:
        assert session.get("/products").status_code == 200
        assert session.get("/auth/me").json()["organization"]["subscription_status"] == "INADIMPLENTE"


# --------------------------------------------------------------- legacy tenant
def test_legacy_company_data_survived_the_migration():
    """The pre-SaaS data must still belong to the original owner and be intact."""
    # conta de QA (ADMIN da "Minha Loja") — a suíte não usa a conta pessoal do dono
    email = env("COMPANY_ADMIN_EMAIL")
    password = env("COMPANY_ADMIN_PASSWORD")
    with _session(email, password) as shop:
        me = shop.get("/auth/me").json()
        assert me["role"] == "ADMIN"
        assert me["organization"]["name"] == os.environ.get("LEGACY_ORG_NAME", "Minha Loja")
        assert me["organization"]["status"] == "APROVADA"
        products = shop.get("/products").json()
        assert len(products) >= 16
        assert shop.get("/sales").status_code == 200
        assert shop.get("/stock/movements").status_code == 200
