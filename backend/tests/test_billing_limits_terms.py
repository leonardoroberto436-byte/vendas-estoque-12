"""Limites por plano, termos no cadastro, teste grátis e cobrança Mercado Pago.

Os testes de cobrança usam um Mercado Pago FALSO (tests/fake_mercadopago.py):
só rodam quando o backend foi iniciado com MP_API_BASE apontando para
http://127.0.0.1:<porta> e MP_WEBHOOK_SECRET definido. Os demais rodam sempre.

Run: cd /app/backend && python -m pytest tests/test_billing_limits_terms.py -q
"""

import hashlib
import hmac
import os
import time
import uuid
from contextlib import contextmanager
from datetime import date, timedelta
from urllib.parse import urlparse

import httpx
import pytest

from tests.credentials import env

API_URL = os.environ.get(
    "BACKEND_URL", "https://vendas-estoque-12.preview.emergentagent.com"
) + "/api"
PASSWORD = "Empresa@2026"
PLATFORM_EMAIL = env("PLATFORM_OWNER_EMAIL")
PLATFORM_PASSWORD = env("PLATFORM_OWNER_PASSWORD")

MP_BASE = os.environ.get("MP_API_BASE", "")
FAKE_MP = MP_BASE.startswith("http://127.0.0.1")
needs_fake_mp = pytest.mark.skipif(
    not (FAKE_MP and os.environ.get("MP_WEBHOOK_SECRET")),
    reason="cobrança testada só com o Mercado Pago falso (MP_API_BASE local)",
)


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


def _owner():
    return _session(PLATFORM_EMAIL, PLATFORM_PASSWORD)


def _company(tag: str, plan: str | None = None) -> dict:
    email = f"tscheck-bill.{tag}.{uuid.uuid4().hex[:8]}@teste-saas.com"
    name = f"TscheckBill {tag} {uuid.uuid4().hex[:6]}"
    with _client() as c:
        resp = c.post(
            "/auth/signup",
            json={"name": "Dono", "company_name": name, "email": email, "password": PASSWORD, "accept_terms": True},
        )
    assert resp.status_code == 201, resp.text
    org_id = resp.json()["organization_id"]
    with _owner() as owner:
        assert owner.put(f"/platform/organizations/{org_id}/status", json={"status": "APROVADA"}).status_code == 200
        if plan:
            resp = owner.put(
                f"/platform/organizations/{org_id}/plan",
                json={"plan": plan, "subscription_status": "ATIVO",
                      "due_date": (date.today() + timedelta(days=30)).isoformat()},
            )
            assert resp.status_code == 200, resp.text
    return {"email": email, "org_id": org_id, "name": name}


def _cleanup(company: dict) -> None:
    with _owner() as owner:
        owner.request("DELETE", f"/platform/organizations/{company['org_id']}", json={"confirm_name": company["name"]})


@pytest.fixture
def inicial():
    info = _company("inicial", plan="INICIAL")
    yield info
    _cleanup(info)


# ------------------------------------------------------------------ termos
def test_signup_requires_accepting_terms():
    with _client() as c:
        resp = c.post(
            "/auth/signup",
            json={"name": "Dono", "company_name": f"Sem termos {uuid.uuid4().hex[:6]}",
                  "email": f"semtermos.{uuid.uuid4().hex[:8]}@teste-saas.com", "password": PASSWORD},
        )
        assert resp.status_code == 400, resp.text
        assert "Termos" in resp.json()["detail"]
        legal = c.get("/legal")
        assert legal.status_code == 200
        assert legal.json()["version"]


# ------------------------------------------------------------------ limites
def test_inicial_plan_limits_users(inicial):
    with _session(inicial["email"], PASSWORD) as admin:
        ok = admin.post("/users", json={"name": "Vendedor Um", "email": f"v1.{uuid.uuid4().hex[:6]}@teste-saas.com",
                                         "password": PASSWORD, "role": "OPERADOR", "is_active": True})
        assert ok.status_code == 201, ok.text  # admin + 1 = 2 (limit)
        blocked = admin.post("/users", json={"name": "Vendedor Dois", "email": f"v2.{uuid.uuid4().hex[:6]}@teste-saas.com",
                                              "password": PASSWORD, "role": "OPERADOR", "is_active": True})
        assert blocked.status_code == 403, blocked.text
        assert "plano" in blocked.json()["detail"].lower()

    with _owner() as owner:
        assert owner.put(f"/platform/organizations/{inicial['org_id']}/limits",
                         json={"extra_users": 1, "extra_products": 0}).status_code == 200
    with _session(inicial["email"], PASSWORD) as admin:
        again = admin.post("/users", json={"name": "Vendedor Dois", "email": f"v2b.{uuid.uuid4().hex[:6]}@teste-saas.com",
                                            "password": PASSWORD, "role": "OPERADOR", "is_active": True})
        assert again.status_code == 201, again.text  # owner's exception


def test_inicial_plan_has_basic_report_history_and_no_logo(inicial):
    tiny_png = (
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )
    with _session(inicial["email"], PASSWORD) as admin:
        report = admin.get("/reports/monthly").json()
        assert report["basic"] is True
        assert report["profit"] == 0 and report["top_products"] == []

        today = date.today()
        old_month = (today.month - 4 - 1) % 12 + 1
        old_year = today.year - (1 if today.month - 4 < 1 else 0)
        old = admin.get(f"/reports/monthly?year={old_year}&month={old_month}")
        assert old.status_code == 403, old.text

        logo = admin.put("/settings/branding", json={"trade_name": "Loja", "logo": tiny_png})
        assert logo.status_code == 403, logo.text
        assert admin.put("/settings/branding", json={"trade_name": "Loja"}).status_code == 200
        assert admin.get("/settings/branding").json()["logo"] is None


def test_billing_page_shows_usage(inicial):
    with _session(inicial["email"], PASSWORD) as admin:
        info = admin.get("/billing")
        assert info.status_code == 200, info.text
        body = info.json()
        assert body["usage"]["users"] == {"used": 1, "limit": 2}
        assert body["limits"]["AVANCADO"]["users"] is None


# ------------------------------------------------------------------ teste grátis
def test_trial_over_admin_only_reaches_subscription_and_seller_is_blocked():
    info = _company("trial")
    try:
        with _session(info["email"], PASSWORD) as admin:
            seller_email = f"seller.{uuid.uuid4().hex[:6]}@teste-saas.com"
            assert admin.post("/users", json={"name": "Vendedor", "email": seller_email, "password": PASSWORD,
                                              "role": "OPERADOR", "is_active": True}).status_code == 201
        with _owner() as owner:
            past = (date.today() - timedelta(days=2)).isoformat()
            resp = owner.put(f"/platform/organizations/{info['org_id']}/plan",
                             json={"plan": "TESTE", "subscription_status": "TESTE", "due_date": past})
            assert resp.json()["billing_block"] == "TESTE_ENCERRADO"

        with _session(info["email"], PASSWORD) as admin:  # admin still logs in
            assert admin.get("/auth/me").json()["organization"]["billing_block"] == "TESTE_ENCERRADO"
            products = admin.get("/products")
            assert products.status_code == 403
            assert products.headers.get("x-billing-block") == "TESTE_ENCERRADO"
            assert admin.get("/billing").status_code == 200

        with _client() as c:
            seller = c.post("/auth/login", json={"email": seller_email, "password": PASSWORD})
            assert seller.status_code == 403, seller.text
    finally:
        _cleanup(info)


# ------------------------------------------------------------------ Mercado Pago (falso)
@pytest.fixture(scope="module")
def fake_mp():
    from tests import fake_mercadopago

    port = urlparse(MP_BASE).port
    server = fake_mercadopago.start(port)
    yield fake_mercadopago.STATE
    server.shutdown()


def _signed_webhook(client: httpx.Client, kind: str, data_id: str, secret: str | None = None):
    secret = secret or os.environ["MP_WEBHOOK_SECRET"]
    ts = str(int(time.time()))
    request_id = uuid.uuid4().hex
    manifest = f"id:{data_id.lower()};request-id:{request_id};ts:{ts};"
    sig = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return client.post(
        f"/billing/webhook?type={kind}&data.id={data_id}",
        json={"type": kind, "data": {"id": data_id}},
        headers={"x-signature": f"ts={ts},v1={sig}", "x-request-id": request_id},
    )


def _mp(path: str, body: dict) -> None:
    httpx.post(MP_BASE + path, json=body, timeout=10).raise_for_status()


@needs_fake_mp
def test_full_subscription_cycle(fake_mp):
    info = _company("mp")
    try:
        with _owner() as owner:  # trial already over
            owner.put(f"/platform/organizations/{info['org_id']}/plan",
                      json={"plan": "TESTE", "subscription_status": "TESTE",
                            "due_date": (date.today() - timedelta(days=1)).isoformat()})

        with _session(info["email"], PASSWORD) as admin:
            assert admin.get("/products").status_code == 403
            sub = admin.post("/billing/subscribe", json={"plan": "PROFISSIONAL", "coupon": "FUNDADOR"})
            assert sub.status_code == 200, sub.text
            assert "mercadopago" in sub.json()["checkout_url"]
            pid = admin.get("/billing").json()
            preapproval_id = next(iter(k for k, v in fake_mp["preapprovals"].items()
                                       if v.get("external_reference") == info["org_id"]))
            assert fake_mp["preapprovals"][preapproval_id]["auto_recurring"]["transaction_amount"] == pytest.approx(
                pid["prices"]["PROFISSIONAL"] * 0.5)

        with _client() as anon:
            bad = anon.post("/billing/webhook?type=subscription_preapproval&data.id=x", json={},
                            headers={"x-signature": "ts=1,v1=deadbeef", "x-request-id": "r"})
            assert bad.status_code == 401

            next_payment = (date.today() + timedelta(days=30)).isoformat() + "T12:00:00.000-03:00"
            _mp(f"/_test/preapproval/{preapproval_id}", {"status": "authorized", "next_payment_date": next_payment})
            ok = _signed_webhook(anon, "subscription_preapproval", preapproval_id)
            assert ok.status_code == 200, ok.text
            assert ok.json()["status"] == "active"

        with _session(info["email"], PASSWORD) as admin:
            billing = admin.get("/billing").json()
            assert billing["subscription_status"] == "ATIVO" and billing["plan"] == "PROFISSIONAL"
            assert billing["coupon"] == "FUNDADOR"
            assert admin.get("/products").status_code == 200  # unblocked

        # card refused -> INADIMPLENTE; daily job (grace 0 in this env) suspends
        with _client() as anon:
            _mp("/_test/payment", {"id": "pay-fail-1", "preapproval_id": preapproval_id,
                                   "status": "recycling", "transaction_amount": 64.5,
                                   "payment": {"id": 1, "status": "rejected"}})
            assert _signed_webhook(anon, "subscription_authorized_payment", "pay-fail-1").json()["status"] == "failed"
        with _session(info["email"], PASSWORD) as admin:
            assert admin.get("/billing").json()["subscription_status"] == "INADIMPLENTE"

        if os.environ.get("PAYMENT_GRACE_DAYS") == "0":
            with _owner() as owner:
                owner.post("/platform/run-due-reminders")
            with _session(info["email"], PASSWORD) as admin:
                me = admin.get("/auth/me").json()
                assert me["organization"]["billing_block"] == "PAGAMENTO"
                assert admin.get("/products").status_code == 403

        # payment approved -> back to ATIVO and reactivated
        with _client() as anon:
            _mp("/_test/payment", {"id": "pay-ok-1", "preapproval_id": preapproval_id,
                                   "status": "processed", "transaction_amount": 64.5,
                                   "payment": {"id": 2, "status": "approved"}})
            assert _signed_webhook(anon, "subscription_authorized_payment", "pay-ok-1").json()["status"] == "paid"
        with _session(info["email"], PASSWORD) as admin:
            assert admin.get("/products").status_code == 200
            billing = admin.get("/billing").json()
            assert billing["subscription_status"] == "ATIVO" and billing["payment_failed_at"] is None

            # downgrade waits for next charge; upgrade is immediate
            down = admin.post("/billing/change-plan", json={"plan": "INICIAL"}).json()
            assert down["plan"] == "PROFISSIONAL" and down["plan_next"] == "INICIAL"
            up = admin.post("/billing/change-plan", json={"plan": "AVANCADO"}).json()
            assert up["plan"] == "AVANCADO" and up["plan_next"] == ""
            assert fake_mp["preapprovals"][preapproval_id]["auto_recurring"]["transaction_amount"] == pytest.approx(
                up["prices"]["AVANCADO"] * 0.5)

            cancelled = admin.post("/billing/cancel").json()
            assert cancelled["cancel_at"]
            assert fake_mp["preapprovals"][preapproval_id]["status"] == "cancelled"
            assert admin.get("/products").status_code == 200  # until the paid period ends

        with _owner() as owner:
            revenue = owner.get("/platform/revenue").json()
            assert revenue["received_last_30d"] >= 64.5
    finally:
        _cleanup(info)


@needs_fake_mp
def test_card_form_subscription_activates_without_mercadopago_account(fake_mp):
    """Cartão digitado no site (token do formulário oficial): ativa na hora,
    sem o cliente precisar de conta no Mercado Pago."""
    info = _company("card")
    try:
        with _session(info["email"], PASSWORD) as admin:
            billing = admin.get("/billing").json()
            assert billing["mp_public_key"]  # formulário de cartão ligado

            refused = admin.post("/billing/subscribe", json={"plan": "INICIAL", "card_token": "recusado-123"})
            assert refused.status_code == 400, refused.text
            assert "limite" in refused.json()["detail"].lower()

            ok = admin.post("/billing/subscribe", json={"plan": "INICIAL", "card_token": "tok-abc-123"})
            assert ok.status_code == 200, ok.text
            assert ok.json()["activated"] is True and ok.json()["checkout_url"] == ""
            sent = next(v for v in fake_mp["preapprovals"].values()
                        if v.get("external_reference") == info["org_id"])
            assert sent["card_token_id"] == "tok-abc-123" and sent["status"] == "authorized"

            billing = admin.get("/billing").json()
            assert billing["subscription_status"] == "ATIVO" and billing["plan"] == "INICIAL"
            assert billing["mp_status"] == "authorized"

            again = admin.post("/billing/subscribe", json={"plan": "INICIAL", "card_token": "tok-2"})
            assert again.status_code == 409  # já está ativa
    finally:
        _cleanup(info)
