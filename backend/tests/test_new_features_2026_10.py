"""Rodada 10/10/2026 — devolução com desconto, relatório líquido, teste grátis
vencido, liga/desliga de alertas, exportação, backup/restauração e remoção de contas.

Run: cd /app/backend && python -m pytest tests/test_new_features_2026_10.py -q
"""

import os
import uuid
from contextlib import contextmanager
from datetime import date, timedelta

import httpx
import pytest

from tests.credentials import env

API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"

PASSWORD = "Empresa@2026"
PLATFORM_EMAIL = env("PLATFORM_OWNER_EMAIL")
PLATFORM_PASSWORD = env("PLATFORM_OWNER_PASSWORD")


def _client() -> httpx.Client:
    return httpx.Client(base_url=API_URL, timeout=60.0)


@contextmanager
def _session(email: str, password: str):
    c = _client()
    resp = c.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    try:
        yield c
    finally:
        c.close()


def _approved_company(tag: str) -> dict:
    email = f"tscheck-r1010.{tag}.{uuid.uuid4().hex[:8]}@teste-saas.com"
    name = f"TscheckR1010 {tag} {uuid.uuid4().hex[:6]}"
    with _client() as c:
        resp = c.post(
            "/auth/signup",
            json={"name": f"Dono {tag}", "company_name": name, "email": email, "password": PASSWORD},
        )
    assert resp.status_code == 201, resp.text
    org_id = resp.json()["organization_id"]
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        resp = owner.put(f"/platform/organizations/{org_id}/status", json={"status": "APROVADA"})
        assert resp.status_code == 200, resp.text
    return {"email": email, "org_id": org_id, "name": name}


def _cleanup(company: dict) -> None:
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        owner.request(
            "DELETE",
            f"/platform/organizations/{company['org_id']}",
            json={"confirm_name": company["name"]},
        )


def _product(admin: httpx.Client, price: float = 100.0, stock: int = 5, min_stock: int = 0) -> dict:
    resp = admin.post(
        "/products",
        json={
            "name": "Produto teste r1010",
            "sku": f"R1010-{uuid.uuid4().hex[:6]}",
            "category": "Testes",
            "cost_price": 40.0,
            "sale_price": price,
            "current_stock": stock,
            "min_stock": min_stock,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def company():
    info = _approved_company("main")
    yield info
    _cleanup(info)


# ------------------------------------------------------------ devoluções
def test_refund_never_exceeds_what_the_customer_paid(company):
    with _session(company["email"], PASSWORD) as admin:
        prod = _product(admin, price=100.0, stock=5)
        sale = admin.post(
            "/sales",
            json={
                "items": [{"product_id": prod["id"], "quantity": 2}],
                "payment_method": "PIX",
                "discount": 40.0,  # paid 160 for 200 of goods
            },
        )
        assert sale.status_code == 201, sale.text
        sale = sale.json()
        assert sale["total"] == 160.0

        first = admin.post(
            "/returns",
            json={"sale_id": sale["id"], "items": [{"product_id": prod["id"], "quantity": 1}]},
        )
        assert first.status_code == 201, first.text
        assert first.json()["refund_total"] == 80.0  # not 100

        second = admin.post(
            "/returns",
            json={"sale_id": sale["id"], "items": [{"product_id": prod["id"], "quantity": 1}]},
        )
        assert second.status_code == 201, second.text
        assert second.json()["refund_total"] == 80.0

        third = admin.post(
            "/returns",
            json={"sale_id": sale["id"], "items": [{"product_id": prod["id"], "quantity": 1}]},
        )
        assert third.status_code == 400, third.text  # nothing left to return

        report = admin.get("/reports/monthly").json()
        assert report["refunds_total"] >= 160.0
        assert report["net_revenue"] == pytest.approx(report["revenue"] - report["refunds_total"])


# ------------------------------------------------------------ alertas
def test_low_stock_alerts_can_be_turned_off_and_on(company):
    with _session(company["email"], PASSWORD) as admin:
        _product(admin, stock=1, min_stock=5)  # below minimum
        assert admin.get("/settings/alerts").json() == {"low_stock_enabled": True}
        assert admin.get("/dashboard/stats").json()["low_stock_count"] >= 1

        off = admin.put("/settings/alerts", json={"low_stock_enabled": False})
        assert off.status_code == 200, off.text
        assert admin.get("/dashboard/stats").json()["low_stock_count"] == 0

        on = admin.put("/settings/alerts", json={"low_stock_enabled": True})
        assert on.status_code == 200, on.text
        assert admin.get("/dashboard/stats").json()["low_stock_count"] >= 1


# ------------------------------------------------------------ exportação
def test_admin_downloads_company_data(company):
    with _session(company["email"], PASSWORD) as admin:
        _product(admin)
        resp = admin.get("/settings/export.xlsx")
        assert resp.status_code == 200, resp.text
        assert "spreadsheetml" in resp.headers["content-type"]
        assert resp.content[:2] == b"PK"  # xlsx is a zip


# ------------------------------------------------------------ teste grátis
def test_expired_trial_blocks_until_owner_picks_a_plan(company):
    yesterday = (date.today() - timedelta(days=2)).isoformat()
    next_month = (date.today() + timedelta(days=30)).isoformat()
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        resp = owner.put(
            f"/platform/organizations/{company['org_id']}/plan",
            json={"plan": "TESTE", "subscription_status": "TESTE", "due_date": yesterday},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["trial_expired"] is True

    with _client() as c:
        blocked = c.post("/auth/login", json={"email": company["email"], "password": PASSWORD})
        assert blocked.status_code == 403, blocked.text
        assert "teste" in blocked.json()["detail"].lower()

    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        resp = owner.put(
            f"/platform/organizations/{company['org_id']}/plan",
            json={"plan": "INICIAL", "subscription_status": "ATIVO", "due_date": next_month},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["trial_expired"] is False

    with _session(company["email"], PASSWORD) as admin:
        assert admin.get("/auth/me").status_code == 200


# ------------------------------------------------------------ backup e restauração
def test_backup_then_restore_preview_lists_company_data(company):
    with _session(company["email"], PASSWORD) as admin:
        _product(admin)
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        run = owner.post("/platform/backups/run")
        assert run.status_code == 200, run.text
        assert run.json()["status"] == "OK"
        settings = owner.get("/platform/backups/settings")
        assert settings.status_code == 200, settings.text

        preview = owner.post(
            f"/platform/backups/{run.json()['file']}/restore",
            json={"org_id": company["org_id"], "confirm": False},
        )
        assert preview.status_code == 200, preview.text
        body = preview.json()
        assert body["applied"] is False
        assert body["counts"]["organizations"] == 1
        assert body["counts"]["products"] >= 1


def test_backup_file_has_no_sessions():
    import io
    import tarfile

    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        run = owner.post("/platform/backups/run").json()
        download = owner.get(f"/platform/backups/{run['file']}/download")
        assert download.status_code == 200
    with tarfile.open(fileobj=io.BytesIO(download.content), mode="r:gz") as tar:
        names = [m.name.rsplit("/", 1)[-1] for m in tar.getmembers()]
    assert "users.jsonl" in names
    assert "sessions.jsonl" not in names
    assert "password_resets.jsonl" not in names


# ------------------------------------------------------------ remoção de contas
def test_owner_deletes_company_only_with_the_right_name():
    info = _approved_company("del")
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        wrong = owner.request(
            "DELETE", f"/platform/organizations/{info['org_id']}", json={"confirm_name": "outra"}
        )
        assert wrong.status_code == 400, wrong.text

        ok = owner.request(
            "DELETE", f"/platform/organizations/{info['org_id']}", json={"confirm_name": info["name"]}
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["deleted_orgs"] == 1
        assert ok.json()["safety_backup"]

        ids = [o["id"] for o in owner.get("/platform/organizations").json()]
        assert info["org_id"] not in ids

    with _client() as c:
        gone = c.post("/auth/login", json={"email": info["email"], "password": PASSWORD})
        assert gone.status_code == 401


def test_bulk_delete_requires_typing_excluir():
    a, b = _approved_company("bulka"), _approved_company("bulkb")
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        refused = owner.post(
            "/platform/organizations/bulk-delete", json={"ids": [a["org_id"]], "confirm": "sim"}
        )
        assert refused.status_code == 400, refused.text
        done = owner.post(
            "/platform/organizations/bulk-delete",
            json={"ids": [a["org_id"], b["org_id"]], "confirm": "EXCLUIR"},
        )
        assert done.status_code == 200, done.text
        assert done.json()["deleted_orgs"] == 2


def test_company_admin_cannot_use_owner_removal():
    info = _approved_company("perm")
    try:
        with _session(info["email"], PASSWORD) as admin:
            resp = admin.request(
                "DELETE", f"/platform/organizations/{info['org_id']}", json={"confirm_name": info["name"]}
            )
            assert resp.status_code == 403
    finally:
        _cleanup(info)


def test_deleted_company_comes_back_from_backup():
    info = _approved_company("undo")
    with _session(info["email"], PASSWORD) as admin:
        _product(admin)
    with _session(PLATFORM_EMAIL, PLATFORM_PASSWORD) as owner:
        backup = owner.post("/platform/backups/run").json()["file"]
        owner.request(
            "DELETE", f"/platform/organizations/{info['org_id']}", json={"confirm_name": info["name"]}
        )
        listed = owner.get(f"/platform/backups/{backup}/organizations").json()
        entry = next(o for o in listed if o["id"] == info["org_id"])
        assert entry["exists_now"] is False

        back = owner.post(
            f"/platform/backups/{backup}/restore", json={"org_id": info["org_id"], "confirm": True}
        )
        assert back.status_code == 200, back.text
        assert back.json()["applied"] is True
    try:
        with _session(info["email"], PASSWORD) as admin:
            assert len(admin.get("/products").json()) == 1
    finally:
        _cleanup(info)
