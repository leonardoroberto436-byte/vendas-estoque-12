"""Auditoria dinâmica de isolamento multiempresa e permissões.

Cria duas empresas FICTÍCIAS (Alfa e Beta) com usuários de papéis diferentes e
executa requisições reais contra a API, registrando o código esperado e o obtido.
Ao final remove tudo que criou. Não toca em dados reais.

Uso: python audit_dynamic.py [base_url]
"""

import asyncio
import os
import sys
import uuid

import httpx

from lib.auth import hash_password
from lib.db import db
from models.org import Organization
from models.users import User

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001") + "/api"
OWNER_EMAIL = os.environ["PLATFORM_OWNER_EMAIL"]
OWNER_PASSWORD = os.environ["PLATFORM_OWNER_PASSWORD"]
PWD = "Auditoria#2026"
TAG = f"audit-{uuid.uuid4().hex[:6]}"
rows: list[tuple[str, str, int, int]] = []


def check(name: str, expected: int, got: int) -> None:
    rows.append((name, "PASSOU" if expected == got else "FALHOU", expected, got))


async def seed() -> dict:
    """Two fictitious companies, each with an ADMIN and an OPERADOR."""
    out = {}
    for key, name in (("A", f"Empresa Alfa {TAG}"), ("B", f"Empresa Beta {TAG}")):
        org = Organization(
            name=name,
            owner_name=f"Responsavel {key}",
            owner_email=f"{TAG}-{key.lower()}-admin@auditoria-exemplo.com",
            status="APROVADA",
            plan="PROFISSIONAL",
            subscription_status="ATIVO",
        )
        await db.organizations.insert_one(org.model_dump())
        users = {}
        for role in ("ADMIN", "OPERADOR"):
            u = User(
                name=f"{role} {key}",
                email=f"{TAG}-{key.lower()}-{role.lower()}@auditoria-exemplo.com",
                role=role,
                org_id=org.id,
                is_active=True,
            )
            doc = u.model_dump()
            doc["password_hash"] = hash_password(PWD)
            await db.users.insert_one(doc)
            users[role] = u.email
        out[key] = {"org": org, "users": users}
    return out


async def login(client: httpx.AsyncClient, email: str, password: str = PWD) -> int:
    r = await client.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    return r.status_code


async def main() -> None:
    seeded = await seed()
    a, b = seeded["A"], seeded["B"]

    async with httpx.AsyncClient(timeout=30) as ca, httpx.AsyncClient(timeout=30) as cb, \
            httpx.AsyncClient(timeout=30) as cop, httpx.AsyncClient(timeout=30) as cow:
        # ---------------------------------------------------------- logins
        check("Login ADMIN empresa A", 200, await login(ca, a["users"]["ADMIN"]))
        check("Login ADMIN empresa B", 200, await login(cb, b["users"]["ADMIN"]))
        check("Login OPERADOR empresa A", 200, await login(cop, a["users"]["OPERADOR"]))
        check("Login dono da plataforma", 200, await login(cow, OWNER_EMAIL, OWNER_PASSWORD))
        check("Login com senha errada", 401, await login(ca.__class__(timeout=10), a["users"]["ADMIN"], "errada"))

        # ------------------------------------------------- dados por empresa
        pa = await ca.post(f"{BASE}/products", json={
            "sku": f"{TAG}-A1", "name": "Produto Alfa", "category": "Teste",
            "sale_price": 10.0, "cost_price": 5.0, "current_stock": 50, "min_stock": 5})
        check("ADMIN A cria produto", 201, pa.status_code)
        pb = await cb.post(f"{BASE}/products", json={
            "sku": f"{TAG}-B1", "name": "Produto Beta", "category": "Teste",
            "sale_price": 20.0, "cost_price": 9.0, "current_stock": 40, "min_stock": 4})
        check("ADMIN B cria produto", 201, pb.status_code)
        if "id" not in pa.json():
            print("DEBUG criar produto:", pa.status_code, pa.text[:400])
            print("DEBUG criar produto B:", pb.status_code, pb.text[:400])
            raise SystemExit(1)
        ida, idb = pa.json()["id"], pb.json()["id"]

        la = await ca.get(f"{BASE}/products")
        check("Listagem de A não contém produto de B", 0,
              len([p for p in la.json() if p["id"] == idb]))

        # ------------------------------------------------------------ IDOR
        check("A lê produto de B (GET id)", 404, (await ca.get(f"{BASE}/products/{idb}")).status_code)
        check("A edita produto de B (PUT)", 404, (await ca.put(
            f"{BASE}/products/{idb}", json={"name": "Invadido"})).status_code)
        check("A apaga produto de B (DELETE)", 404,
              (await ca.delete(f"{BASE}/products/{idb}")).status_code)
        check("A movimenta estoque de B", 404, (await ca.post(
            f"{BASE}/stock/movements",
            json={"product_id": idb, "type": "ENTRADA", "quantity": 5, "reason": "idor"})).status_code)
        check("A vende produto de B", 404, (await ca.post(f"{BASE}/sales", json={
            "items": [{"product_id": idb, "quantity": 1}], "discount": 0,
            "payment_method": "DINHEIRO"})).status_code)

        sb = await cb.post(f"{BASE}/sales", json={
            "items": [{"product_id": idb, "quantity": 2}], "discount": 0,
            "payment_method": "PIX"})
        check("B registra venda própria", 201, sb.status_code)
        sale_b = sb.json()["id"]
        check("A lê venda de B", 404, (await ca.get(f"{BASE}/sales/{sale_b}")).status_code)
        check("A devolve venda de B", 404, (await ca.post(f"{BASE}/returns", json={
            "sale_id": sale_b, "items": [{"product_id": idb, "quantity": 1}],
            "reason": "idor"})).status_code)

        ub = await cb.get(f"{BASE}/users")
        uid_b = [u["id"] for u in ub.json()][0]
        check("A edita usuário de B", 404, (await ca.put(
            f"{BASE}/users/{uid_b}", json={"name": "Invadido"})).status_code)
        check("A apaga usuário de B", 404, (await ca.delete(f"{BASE}/users/{uid_b}")).status_code)
        check("A redefine senha de usuário de B", 404, (await ca.put(
            f"{BASE}/users/{uid_b}/password", json={"password": "QualquerCoisa1"})).status_code)

        # ------------------------------------------- permissões do vendedor
        check("OPERADOR lista usuários", 403, (await cop.get(f"{BASE}/users")).status_code)
        check("OPERADOR cria usuário", 403, (await cop.post(f"{BASE}/users", json={
            "name": "x", "email": f"{TAG}-x@auditoria-exemplo.com", "role": "ADMIN",
            "password": "Senha12345"})).status_code)
        check("OPERADOR vê registros de acesso", 403,
              (await cop.get(f"{BASE}/users/access-logs")).status_code)
        check("OPERADOR altera marca da empresa", 403, (await cop.put(
            f"{BASE}/settings/branding", json={"trade_name": "x"})).status_code)
        check("OPERADOR lê produtos (permitido)", 200, (await cop.get(f"{BASE}/products")).status_code)
        check("OPERADOR vê painel (permitido)", 200, (await cop.get(f"{BASE}/dashboard/stats")).status_code)
        check("OPERADOR registra venda (permitido)", 201, (await cop.post(f"{BASE}/sales", json={
            "items": [{"product_id": ida, "quantity": 1}], "discount": 0,
            "payment_method": "DINHEIRO"})).status_code)
        check("OPERADOR apaga produto", 403, (await cop.delete(f"{BASE}/products/{ida}")).status_code)
        check("OPERADOR edita produto", 403, (await cop.put(
            f"{BASE}/products/{ida}", json={"name": "alterado"})).status_code)
        check("OPERADOR cria produto", 403, (await cop.post(f"{BASE}/products", json={
            "sku": f"{TAG}-OP", "name": "x", "category": "x", "sale_price": 1.0,
            "cost_price": 1.0, "current_stock": 1, "min_stock": 1})).status_code)
        check("OPERADOR ajusta estoque", 403, (await cop.post(
            f"{BASE}/stock/movements",
            json={"product_id": ida, "type": "AJUSTE_POSITIVO", "quantity": 99,
                  "reason": "x"})).status_code)

        # --------------------------------------- administração global (dono)
        for path in ("/platform/stats", "/platform/organizations", "/platform/users",
                     "/platform/revenue", "/platform/plan-prices"):
            check(f"ADMIN de empresa acessa {path}", 403, (await ca.get(f"{BASE}{path}")).status_code)
            check(f"Dono da plataforma acessa {path}", 200, (await cow.get(f"{BASE}{path}")).status_code)
        check("OPERADOR acessa /platform/organizations", 403,
              (await cop.get(f"{BASE}/platform/organizations")).status_code)
        check("ADMIN de empresa cria empresa", 403, (await ca.post(
            f"{BASE}/platform/organizations", json={"company_name": "Hack",
            "owner_name": "h", "owner_email": f"{TAG}-hack@auditoria-exemplo.com"})).status_code)
        check("ADMIN de empresa suspende outra", 403, (await ca.put(
            f"{BASE}/platform/organizations/{b['org'].id}/status",
            json={"status": "SUSPENSA"})).status_code)
        check("ADMIN de empresa redefine admin de outra", 403, (await ca.post(
            f"{BASE}/platform/organizations/{b['org'].id}/admin-password")).status_code)

        # dono da plataforma NÃO acessa dados de empresa
        for path in ("/products", "/sales", "/dashboard/stats", "/settings/branding",
                     "/stock/movements", "/returns", "/users"):
            check(f"Dono da plataforma acessa {path} de empresa", 403,
                  (await cow.get(f"{BASE}{path}")).status_code)

        # ------------------------------- bloqueio da empresa e sessão viva
        check("Sessão de B válida antes do bloqueio", 200, (await cb.get(f"{BASE}/products")).status_code)
        await cow.put(f"{BASE}/platform/organizations/{b['org'].id}/status",
                      json={"status": "SUSPENSA"})
        check("Sessão já aberta de B após suspensão", 401,
              (await cb.get(f"{BASE}/products")).status_code)
        check("B cria produto após suspensão", 401, (await cb.post(f"{BASE}/products", json={
            "sku": f"{TAG}-B2", "name": "x", "category": "x", "sale_price": 1.0,
            "cost_price": 1.0, "current_stock": 1, "min_stock": 1})).status_code)
        check("Novo login de B após suspensão", 403, await login(cb, b["users"]["ADMIN"]))

        await cow.put(f"{BASE}/platform/organizations/{b['org'].id}/status",
                      json={"status": "APROVADA"})
        await cow.put(f"{BASE}/platform/organizations/{b['org'].id}/plan",
                      json={"plan": "PROFISSIONAL", "subscription_status": "CANCELADO"})
        check("Login de B com assinatura cancelada", 403, await login(cb, b["users"]["ADMIN"]))

        # usuário desativado perde a sessão
        uid_op = [u["id"] for u in (await ca.get(f"{BASE}/users")).json()
                  if u["role"] == "OPERADOR"][0]
        await ca.put(f"{BASE}/users/{uid_op}", json={"is_active": False})
        check("Sessão de vendedor desativado", 401, (await cop.get(f"{BASE}/sales")).status_code)

        # ------------------------------------- segredos em respostas da API
        me = (await ca.get(f"{BASE}/auth/me")).text
        users_json = (await ca.get(f"{BASE}/users")).text
        plat = (await cow.get(f"{BASE}/platform/users")).text + \
               (await cow.get(f"{BASE}/platform/organizations")).text
        leaked = [w for w in ("password_hash", "password", "token", "secret", PWD)
                  if w in me or w in users_json or w in plat]
        check("Nenhum segredo nas respostas da API", 0, len(leaked))
        if leaked:
            print("VAZADO:", leaked)

        # sem autenticação nenhuma
        async with httpx.AsyncClient(timeout=15) as anon:
            for path in ("/products", "/sales", "/users", "/platform/organizations",
                         "/settings/branding", "/dashboard/stats"):
                check(f"Anônimo acessa {path}", 401, (await anon.get(f"{BASE}{path}")).status_code)
            check("Anônimo dispara cron", 401,
                  (await anon.post(f"{BASE}/cron/subscription-reminders")).status_code)
            check("Cron com token errado", 401, (await anon.post(
                f"{BASE}/cron/subscription-reminders",
                headers={"Authorization": "Bearer errado"})).status_code)

    # ------------------------------------------------------------- limpeza
    orgs = [a["org"].id, b["org"].id]
    for col in (db.products, db.sales, db.stock_movements, db.returns,
                db.access_logs, db.users):
        await col.delete_many({"org_id": {"$in": orgs}})
    await db.organizations.delete_many({"id": {"$in": orgs}})

    width = max(len(r[0]) for r in rows) + 2
    print(f"\n{'TESTE'.ljust(width)}RESULTADO  ESPERADO  OBTIDO")
    for name, result, exp, got in rows:
        print(f"{name.ljust(width)}{result:10s} {exp:>8}  {got:>6}")
    failed = [r for r in rows if r[1] == "FALHOU"]
    print(f"\nTOTAL: {len(rows)} testes · {len(rows) - len(failed)} passaram · {len(failed)} falharam")
    for f in failed:
        print("  FALHA:", f[0], "esperado", f[2], "obtido", f[3])


asyncio.run(main())
