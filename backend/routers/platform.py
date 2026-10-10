"""Platform owner area — mounted under /api/platform.

Every route requires the `platform:manage` permission, which only
PLATFORM_OWNER has. A customer's ADMIN has `users:manage` but NOT
`platform:manage`, so this whole module is closed to them (403).

This is also the only module allowed to read across organizations.
"""

import asyncio
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from fastapi.responses import FileResponse

from lib.auth import ROLE_ADMIN, Principal, hash_password, require, trial_expired
from lib.backups import (
    KEEP_BACKUPS,
    backup_path,
    log_platform_action,
    offsite_configured,
    run_backup,
)
from lib.db import db
from lib.email import send_org_approved
from lib.subscriptions import (
    PAYING_STATUSES,
    days_until,
    get_plan_prices,
    run_due_reminders,
    set_plan_prices,
)
from lib.restore import read_archive, select_org, write as restore_write
from models.org import (
    DEFAULT_PLAN_PRICES,
    BackupRecord,
    BackupSettings,
    DeleteResult,
    OrgBulkDeleteRequest,
    OrgDeleteRequest,
    RestoreOrgRequest,
    RestoreResult,
    PlatformLog,
    PLAN_LABELS,
    TRIAL_DAYS,
    OrgCreateRequest,
    OrgCredentials,
    OrgPlanUpdate,
    OrgStatusUpdate,
    OrgUpdateRequest,
    Organization,
    PlanPrices,
    PlanRevenue,
    PlatformOrgView,
    PlatformRevenue,
    PlatformStats,
    PlatformUserView,
)
from models.users import User

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/platform",
    tags=["platform"],
    dependencies=[Depends(require("platform:manage"))],
)


# Quem está agindo — usado só para a trilha de auditoria do proprietário.
_owner = require("platform:manage")


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _to_view(org: dict) -> PlatformOrgView:
    org_filter = {"org_id": org["id"]}
    trial_ends = _aware(org.get("trial_ends_at"))
    days_left = None
    if trial_ends:
        days_left = max(0, (trial_ends - datetime.now(timezone.utc)).days)

    last_sale = await db.sales.find_one(org_filter, sort=[("created_at", -1)])
    return PlatformOrgView(
        id=org["id"],
        name=org["name"],
        status=org["status"],
        plan=org["plan"],
        plan_label=PLAN_LABELS.get(org["plan"], org["plan"]),
        subscription_status=org["subscription_status"],
        trial_ends_at=trial_ends,
        trial_days_left=days_left,
        trial_expired=trial_expired(org),
        due_date=_aware(org.get("due_date")),
        days_to_due=days_until(org.get("due_date")),
        owner_name=org.get("owner_name", ""),
        owner_email=org.get("owner_email", ""),
        created_at=_aware(org["created_at"]),
        approved_at=_aware(org.get("approved_at")),
        suspended_at=_aware(org.get("suspended_at")),
        user_count=await db.users.count_documents(org_filter),
        product_count=await db.products.count_documents(org_filter),
        sales_count=await db.sales.count_documents(org_filter),
        last_activity_at=_aware(last_sale["created_at"]) if last_sale else None,
    )


def _generate_password() -> str:
    """Readable temporary password — shown once to the owner, never stored in clear."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10)) + "@2026"


@router.post("/organizations", response_model=OrgCredentials, status_code=201)
async def create_organization(
    payload: OrgCreateRequest, principal: Principal = Depends(_owner)
):
    """Owner registers a customer company and its ADMIN in one step.

    The company is born APROVADA (the owner is the one approving it) with its own
    org_id, so every row it creates from now on lives in an isolated workspace.
    """
    email = payload.owner_email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.")
    if await db.organizations.find_one({"name": payload.company_name.strip()}):
        raise HTTPException(status_code=409, detail="Já existe uma empresa com este nome.")

    now = datetime.now(timezone.utc)
    org = Organization(
        name=payload.company_name.strip(),
        owner_name=payload.owner_name.strip(),
        owner_email=email,
        status="APROVADA",
        plan=payload.plan,
        subscription_status=payload.subscription_status,
        trial_ends_at=now + timedelta(days=TRIAL_DAYS) if payload.plan == "TESTE" else None,
        approved_at=now,
    )
    await db.organizations.insert_one(org.model_dump())

    password = _generate_password()
    admin = User(
        name=payload.owner_name.strip(),
        email=email,
        role=ROLE_ADMIN,
        org_id=org.id,
        is_active=True,
    )
    doc = admin.model_dump()
    doc["password_hash"] = hash_password(password)
    await db.users.insert_one(doc)

    email_sent = False
    if payload.send_email:
        try:
            await send_org_approved(
                to=email, name=admin.name, company=org.name, trial_days=TRIAL_DAYS
            )
            email_sent = True
        except HTTPException as exc:
            logger.warning("Welcome email não enviado para %s: %s", email, exc.detail)

    await log_platform_action(
        actor_email=principal.email,
        action="EMPRESA_CRIADA",
        target=org.name,
        details=f"plano {org.plan} · admin {email}",
    )
    created = await db.organizations.find_one({"id": org.id})
    return OrgCredentials(
        organization=await _to_view(created),
        admin_email=email,
        admin_password=password,
        email_sent=email_sent,
        message=(
            "Empresa criada e liberada. Repasse o e-mail e a senha abaixo ao cliente — "
            "esta senha só aparece agora."
        ),
    )


@router.put("/organizations/{org_id}", response_model=PlatformOrgView)
async def update_organization(
    org_id: str, payload: OrgUpdateRequest, principal: Principal = Depends(_owner)
):
    """Edit company name and responsible person. The admin login follows the e-mail."""
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    email = payload.owner_email.strip().lower()
    clash = await db.users.find_one({"email": email, "org_id": {"$ne": org_id}})
    if clash:
        raise HTTPException(status_code=409, detail="Este e-mail já é usado por outra conta.")

    await db.organizations.update_one(
        {"id": org_id},
        {
            "$set": {
                "name": payload.name.strip(),
                "owner_name": payload.owner_name.strip(),
                "owner_email": email,
            }
        },
    )
    # keep the company's admin account in sync with the responsible person
    admin = await db.users.find_one({"org_id": org_id, "email": org.get("owner_email", "")})
    if admin:
        await db.users.update_one(
            {"id": admin["id"]},
            {"$set": {"name": payload.owner_name.strip(), "email": email}},
        )

    await log_platform_action(
        actor_email=principal.email,
        action="EMPRESA_EDITADA",
        target=payload.name.strip(),
        details=f"responsável {payload.owner_name.strip()} · {email}",
    )
    updated = await db.organizations.find_one({"id": org_id})
    return await _to_view(updated)


@router.post("/organizations/{org_id}/admin-password", response_model=OrgCredentials)
async def reset_org_admin(org_id: str, principal: Principal = Depends(_owner)):
    """Generate a fresh password for the company's admin (creating the account if missing)."""
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    email = (org.get("owner_email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Empresa sem e-mail de responsável.")

    password = _generate_password()
    admin = await db.users.find_one({"org_id": org_id, "email": email})
    if admin:
        await db.users.update_one(
            {"id": admin["id"]},
            {"$set": {"password_hash": hash_password(password), "is_active": True}},
        )
        await db.sessions.delete_many({"user_id": admin["id"]})
    else:
        new_admin = User(
            name=org.get("owner_name", "Administrador"),
            email=email,
            role=ROLE_ADMIN,
            org_id=org_id,
            is_active=True,
        )
        doc = new_admin.model_dump()
        doc["password_hash"] = hash_password(password)
        await db.users.insert_one(doc)

    await log_platform_action(
        actor_email=principal.email,
        action="SENHA_ADMIN_REDEFINIDA",
        target=org.get("name", ""),
        details=f"admin {email} · sessões encerradas",
    )
    return OrgCredentials(
        organization=await _to_view(org),
        admin_email=email,
        admin_password=password,
        email_sent=False,
        message="Nova senha gerada. As sessões anteriores desse administrador foram encerradas.",
    )


@router.get("/stats", response_model=PlatformStats)
async def platform_stats():
    orgs = await db.organizations.find().sort("created_at", -1).to_list(2000)
    by_plan: dict[str, int] = {}
    by_subscription: dict[str, int] = {}
    for org in orgs:
        by_plan[org["plan"]] = by_plan.get(org["plan"], 0) + 1
        key = org["subscription_status"]
        by_subscription[key] = by_subscription.get(key, 0) + 1

    recent = [await _to_view(org) for org in orgs[:5]]
    return PlatformStats(
        total_orgs=len(orgs),
        pending_orgs=sum(1 for o in orgs if o["status"] == "PENDENTE"),
        approved_orgs=sum(1 for o in orgs if o["status"] == "APROVADA"),
        suspended_orgs=sum(1 for o in orgs if o["status"] == "SUSPENSA"),
        total_users=await db.users.count_documents({"role": {"$ne": "PLATFORM_OWNER"}}),
        by_plan=by_plan,
        by_subscription=by_subscription,
        recent_orgs=recent,
    )


@router.get("/organizations", response_model=List[PlatformOrgView])
async def list_organizations():
    orgs = await db.organizations.find().sort("created_at", -1).to_list(2000)
    return [await _to_view(org) for org in orgs]


@router.get("/users", response_model=List[PlatformUserView])
async def list_all_users():
    users = await db.users.find().sort("created_at", -1).to_list(5000)
    orgs = await db.organizations.find({}, {"id": 1, "name": 1}).to_list(2000)
    names = {o["id"]: o["name"] for o in orgs}
    return [
        PlatformUserView(
            id=u["id"],
            name=u["name"],
            email=u["email"],
            role=u["role"],
            is_active=u.get("is_active", False),
            org_id=u.get("org_id"),
            org_name=names.get(u.get("org_id") or "", "— plataforma —"),
            created_at=_aware(u["created_at"]),
            last_login_at=_aware(u.get("last_login_at")),
        )
        for u in users
    ]


@router.put("/organizations/{org_id}/status", response_model=PlatformOrgView)
async def set_org_status(
    org_id: str, payload: OrgStatusUpdate, principal: Principal = Depends(_owner)
):
    """Approve a pending signup, suspend an abusive/unpaid company, or reactivate it."""
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    now = datetime.now(timezone.utc)
    changes: dict = {"status": payload.status}
    newly_approved = payload.status == "APROVADA" and org["status"] != "APROVADA"

    if newly_approved:
        changes["approved_at"] = now
        changes["suspended_at"] = None
        if not org.get("trial_ends_at"):
            changes["trial_ends_at"] = now + timedelta(days=TRIAL_DAYS)
            changes["subscription_status"] = "TESTE"
            changes["plan"] = "TESTE"
    if payload.status == "SUSPENSA":
        changes["suspended_at"] = now
        # revoke live sessions of that company immediately
        members = await db.users.find({"org_id": org_id}, {"id": 1}).to_list(5000)
        if members:
            await db.sessions.delete_many({"user_id": {"$in": [m["id"] for m in members]}})

    await db.organizations.update_one({"id": org_id}, {"$set": changes})

    if newly_approved and org.get("owner_email"):
        try:
            await send_org_approved(
                to=org["owner_email"],
                name=org.get("owner_name", ""),
                company=org["name"],
                trial_days=TRIAL_DAYS,
            )
        except HTTPException as exc:
            logger.warning("Approval email não enviado para %s: %s", org["owner_email"], exc.detail)

    await log_platform_action(
        actor_email=principal.email,
        action=f"STATUS_{payload.status}",
        target=org.get("name", ""),
        details=f"de {org.get('status')} para {payload.status}",
    )
    updated = await db.organizations.find_one({"id": org_id})
    return await _to_view(updated)


@router.put("/organizations/{org_id}/plan", response_model=PlatformOrgView)
async def set_org_plan(
    org_id: str, payload: OrgPlanUpdate, principal: Principal = Depends(_owner)
):
    """Plan + subscription state only. No charge is made here — billing comes later."""
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    changes: dict = {
        "plan": payload.plan,
        "subscription_status": payload.subscription_status,
    }
    if payload.due_date is None:
        changes["due_date"] = None
    else:
        try:
            # noon UTC keeps the date stable when read back in America/Sao_Paulo
            changes["due_date"] = datetime.fromisoformat(payload.due_date).replace(
                hour=12, minute=0, tzinfo=timezone.utc
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Data de vencimento inválida.")
        # a new due date starts a fresh reminder cycle
        changes["reminders_sent"] = []
        if payload.subscription_status == "TESTE":
            # na fase de teste a data informada é o novo fim do teste grátis —
            # é assim que o dono prorroga um teste que já terminou
            changes["trial_ends_at"] = changes["due_date"].replace(hour=23, minute=59)
    await db.organizations.update_one({"id": org_id}, {"$set": changes})
    await log_platform_action(
        actor_email=principal.email,
        action="PLANO_ALTERADO",
        target=org.get("name", ""),
        details=(
            f"{payload.plan} · assinatura {payload.subscription_status}"
            f" · vencimento {payload.due_date or 'sem data'}"
        ),
    )

    if payload.subscription_status == "CANCELADO":
        members = await db.users.find({"org_id": org_id}, {"id": 1}).to_list(5000)
        if members:
            await db.sessions.delete_many({"user_id": {"$in": [m["id"] for m in members]}})

    updated = await db.organizations.find_one({"id": org_id})
    return await _to_view(updated)


# --------------------------------------------------------------- revenue (MRR)
@router.get("/plan-prices", response_model=PlanPrices)
async def read_plan_prices():
    return PlanPrices(prices=await get_plan_prices())


@router.put("/plan-prices", response_model=PlanPrices)
async def write_plan_prices(
    payload: PlanPrices, principal: Principal = Depends(_owner)
):
    unknown = set(payload.prices) - set(DEFAULT_PLAN_PRICES)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Plano desconhecido: {', '.join(unknown)}")
    prices = await set_plan_prices(payload.prices)
    await log_platform_action(
        actor_email=principal.email,
        action="PRECOS_ALTERADOS",
        target="planos",
        details=" · ".join(f"{k} R$ {v:.2f}" for k, v in prices.items()),
    )
    return PlanPrices(prices=prices)


@router.get("/revenue", response_model=PlatformRevenue)
async def platform_revenue():
    """Recurring revenue: what is actually billable today versus what is late.

    `mrr` counts only ATIVO companies. INADIMPLENTE companies still owe, so
    their value lands in `overdue_amount`; `expected_mrr` is the two combined.
    """
    prices = await get_plan_prices()
    orgs = await db.organizations.find({"status": "APROVADA"}).to_list(5000)

    rows: list[PlanRevenue] = []
    mrr = overdue = 0.0
    paying = trials = 0
    for plan, price in prices.items():
        in_plan = [o for o in orgs if o.get("plan") == plan]
        billable = [o for o in in_plan if o.get("subscription_status") in PAYING_STATUSES]
        active = [o for o in billable if o.get("subscription_status") == "ATIVO"]
        late = [o for o in billable if o.get("subscription_status") == "INADIMPLENTE"]
        mrr += price * len(active)
        overdue += price * len(late)
        paying += len(billable)
        if plan == "TESTE":
            trials += len(in_plan)
        rows.append(
            PlanRevenue(
                plan=plan,  # type: ignore[arg-type]
                plan_label=PLAN_LABELS.get(plan, plan),
                price=price,
                paying_orgs=len(billable),
                total_orgs=len(in_plan),
                monthly_revenue=round(price * len(billable), 2),
            )
        )

    return PlatformRevenue(
        mrr=round(mrr, 2),
        expected_mrr=round(mrr + overdue, 2),
        overdue_amount=round(overdue, 2),
        paying_orgs=paying,
        trial_orgs=trials,
        by_plan=rows,
    )


@router.post("/run-due-reminders")
async def trigger_due_reminders():
    """Manual trigger for the daily reminder job — same code path as the cron."""
    return await run_due_reminders()


# ------------------------------------------------- auditoria e backups
@router.get("/logs", response_model=List[PlatformLog])
async def platform_logs(limit: int = 200):
    """Quem fez o quê na plataforma — ações do proprietário, mais recentes primeiro."""
    docs = await db.platform_logs.find().sort("created_at", -1).to_list(min(limit, 500))
    return [
        PlatformLog(
            id=d["id"],
            actor_email=d.get("actor_email", ""),
            action=d.get("action", ""),
            target=d.get("target", ""),
            details=d.get("details", ""),
            created_at=_aware(d["created_at"]),
        )
        for d in docs
    ]


@router.get("/backups", response_model=List[BackupRecord])
async def list_backups(limit: int = 30):
    docs = await db.backups.find().sort("created_at", -1).to_list(min(limit, 100))
    return [
        BackupRecord(
            id=d["id"],
            file=d.get("file", ""),
            size_bytes=d.get("size_bytes", 0),
            status=d.get("status", ""),
            error=d.get("error", ""),
            offsite=d.get("offsite", ""),
            created_at=_aware(d["created_at"]),
        )
        for d in docs
    ]


@router.get("/backups/settings", response_model=BackupSettings)
async def backup_settings():
    """Se a cópia externa (fora do servidor) está ligada — o painel avisa quando não está."""
    return BackupSettings(offsite_configured=offsite_configured(), keep=KEEP_BACKUPS)


@router.post("/backups/run", response_model=BackupRecord)
async def create_backup(principal: Principal = Depends(_owner)):
    """Backup manual — mesmo caminho do backup automático diário."""
    result = await run_backup()
    await log_platform_action(
        actor_email=principal.email,
        action="BACKUP_MANUAL",
        target=result.get("file", ""),
        details=result.get("status", ""),
    )
    doc = await db.backups.find_one(sort=[("created_at", -1)])
    if not doc:
        raise HTTPException(status_code=500, detail="Backup não registrado")
    return BackupRecord(
        id=doc["id"],
        file=doc.get("file", ""),
        size_bytes=doc.get("size_bytes", 0),
        status=doc.get("status", ""),
        error=doc.get("error", ""),
        offsite=doc.get("offsite", ""),
        created_at=_aware(doc["created_at"]),
    )


@router.get("/backups/{file_name}/download")
async def download_backup(file_name: str):
    """Baixa o arquivo para guarda fora do servidor."""
    try:
        path = backup_path(file_name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Arquivo de backup não encontrado")
    return FileResponse(path, media_type="application/gzip", filename=path.name)


@router.get("/backups/{file_name}/organizations")
async def organizations_in_backup(file_name: str):
    """Empresas que existem neste backup — inclusive as que já foram excluídas,
    para o dono poder trazê-las de volta pelo painel."""
    try:
        path = backup_path(file_name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Arquivo de backup não encontrado")
    try:
        data = await asyncio.to_thread(read_archive, path)
    except Exception as exc:  # noqa: BLE001
        logger.error("Leitura do backup %s falhou: %s", file_name, exc)
        raise HTTPException(status_code=400, detail="Não foi possível ler este arquivo de backup.")
    current = {o["id"] for o in await db.organizations.find({}, {"id": 1}).to_list(5000)}
    orgs = sorted(data.get("organizations", []), key=lambda o: o.get("name", "").lower())
    return [
        {"id": o["id"], "name": o.get("name", ""), "exists_now": o["id"] in current}
        for o in orgs
        if o.get("id")
    ]


@router.post("/backups/{file_name}/restore", response_model=RestoreResult)
async def restore_org_from_backup(
    file_name: str, payload: RestoreOrgRequest, principal: Principal = Depends(_owner)
):
    """Devolve os dados de UMA empresa como estavam no backup escolhido.

    Com confirm=false só mostra o que seria restaurado. Com confirm=true faz antes
    um backup do estado atual (para poder voltar atrás) e então regrava os
    registros da empresa que estão no backup. Registros criados depois do backup
    não são apagados.
    """
    try:
        path = backup_path(file_name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Arquivo de backup não encontrado")

    try:
        data = await asyncio.to_thread(read_archive, path)
    except Exception as exc:  # noqa: BLE001 — arquivo corrompido/formato inesperado
        logger.error("Leitura do backup %s falhou: %s", file_name, exc)
        raise HTTPException(status_code=400, detail="Não foi possível ler este arquivo de backup.")

    plan = select_org(data, payload.org_id)
    if not plan["organizations"]:
        raise HTTPException(status_code=404, detail="Esta empresa não existe neste backup.")
    org_name = plan["organizations"][0].get("name", "")
    counts = {name: len(docs) for name, docs in plan.items()}

    if not payload.confirm:
        return RestoreResult(
            org_id=payload.org_id,
            org_name=org_name,
            file=path.name,
            counts=counts,
            applied=False,
            message="Simulação: confira os números e confirme para restaurar.",
        )

    safety = await run_backup()
    if safety.get("status") != "OK":
        raise HTTPException(
            status_code=500,
            detail="O backup de segurança antes da restauração falhou — nada foi alterado.",
        )
    await restore_write(plan)
    await log_platform_action(
        actor_email=principal.email,
        action="EMPRESA_RESTAURADA",
        target=org_name,
        details=f"do backup {path.name} · segurança {safety.get('file', '')}",
    )
    return RestoreResult(
        org_id=payload.org_id,
        org_name=org_name,
        file=path.name,
        counts=counts,
        applied=True,
        safety_backup=safety.get("file", ""),
        message="Dados da empresa restaurados. Um backup do estado anterior foi guardado.",
    )


# ------------------------------------------------------- remoção de contas
# Tudo o que pertence a uma empresa pelo campo org_id.
_ORG_DATA = ("products", "sales", "returns", "stock_movements", "access_logs")


async def _purge_org(org: dict) -> tuple[int, int]:
    """Apaga a empresa e TUDO dela. Devolve (usuários apagados, outros registros apagados)."""
    org_id = org["id"]
    members = await db.users.find({"org_id": org_id}, {"id": 1}).to_list(5000)
    member_ids = [m["id"] for m in members]
    if member_ids:
        await db.sessions.delete_many({"user_id": {"$in": member_ids}})
        await db.password_resets.delete_many({"user_id": {"$in": member_ids}})
    users = (await db.users.delete_many({"org_id": org_id})).deleted_count
    records = 0
    for name in _ORG_DATA:
        records += (await db[name].delete_many({"org_id": org_id})).deleted_count
    await db.organizations.delete_one({"id": org_id})
    return users, records


async def _safety_backup() -> str:
    safety = await run_backup()
    if safety.get("status") != "OK":
        raise HTTPException(
            status_code=500,
            detail="O backup de segurança antes da exclusão falhou — nada foi apagado.",
        )
    return safety.get("file", "")


@router.delete("/organizations/{org_id}", response_model=DeleteResult)
async def delete_organization(
    org_id: str, payload: OrgDeleteRequest, principal: Principal = Depends(_owner)
):
    """Remove uma empresa (ex.: conta de teste) com todos os dados dela.

    Exige digitar o nome da empresa. Antes de apagar é feito um backup, então dá
    para trazer a empresa de volta pela restauração de backup.
    """
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    if payload.confirm_name.strip() != org.get("name", "").strip():
        raise HTTPException(
            status_code=400, detail="O nome digitado não confere com o nome da empresa."
        )

    safety = await _safety_backup()
    users, records = await _purge_org(org)
    await log_platform_action(
        actor_email=principal.email,
        action="EMPRESA_EXCLUIDA",
        target=org.get("name", ""),
        details=f"{users} usuário(s) · {records} registro(s) · backup {safety}",
    )
    return DeleteResult(
        deleted_orgs=1,
        deleted_users=users,
        deleted_records=records,
        safety_backup=safety,
        message=f"Empresa {org.get('name', '')} removida. Backup de segurança: {safety}.",
    )


@router.post("/organizations/bulk-delete", response_model=DeleteResult)
async def bulk_delete_organizations(
    payload: OrgBulkDeleteRequest, principal: Principal = Depends(_owner)
):
    """Remove várias empresas de uma vez — para limpar as contas de teste."""
    if payload.confirm.strip().upper() != "EXCLUIR":
        raise HTTPException(status_code=400, detail='Digite EXCLUIR para confirmar.')

    orgs = await db.organizations.find({"id": {"$in": list(set(payload.ids))}}).to_list(500)
    if not orgs:
        raise HTTPException(status_code=404, detail="Nenhuma das empresas foi encontrada.")

    safety = await _safety_backup()
    total_users = total_records = 0
    for org in orgs:
        users, records = await _purge_org(org)
        total_users += users
        total_records += records
        await log_platform_action(
            actor_email=principal.email,
            action="EMPRESA_EXCLUIDA",
            target=org.get("name", ""),
            details=f"exclusão em lote · {users} usuário(s) · {records} registro(s) · backup {safety}",
        )
    return DeleteResult(
        deleted_orgs=len(orgs),
        deleted_users=total_users,
        deleted_records=total_records,
        safety_backup=safety,
        message=f"{len(orgs)} empresa(s) removida(s). Backup de segurança: {safety}.",
    )


@router.delete("/users/{user_id}", status_code=204)
async def delete_platform_user(user_id: str, principal: Principal = Depends(_owner)):
    """Remove um usuário solto (ex.: login de teste) sem mexer no resto da empresa."""
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.get("role") == "PLATFORM_OWNER":
        raise HTTPException(status_code=400, detail="A conta do dono da plataforma não pode ser removida.")
    if user.get("role") == ROLE_ADMIN and user.get("org_id"):
        others = await db.users.count_documents(
            {"org_id": user["org_id"], "role": ROLE_ADMIN, "is_active": True, "id": {"$ne": user_id}}
        )
        if others == 0:
            raise HTTPException(
                status_code=400,
                detail="Este é o único administrador da empresa. Para remover, exclua a empresa inteira.",
            )
    await db.sessions.delete_many({"user_id": user_id})
    await db.password_resets.delete_many({"user_id": user_id})
    await db.users.delete_one({"id": user_id})
    await log_platform_action(
        actor_email=principal.email,
        action="USUARIO_EXCLUIDO",
        target=user.get("email", ""),
        details=f"papel {user.get('role')}",
    )
    return None
