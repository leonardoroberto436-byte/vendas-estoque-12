"""Safe, idempotent migration: single-tenant  ->  multi-tenant SaaS.

What it does, in order:
  1. BACKUP the whole database to /app/backups/<timestamp>/ (mongodump if
     available, otherwise a JSON dump per collection). Nothing is touched until
     the backup finished.
  2. Create (or reuse) the organization that owns the pre-existing data.
  3. Backfill `org_id` on every legacy row that has none: products, sales,
     stock_movements, returns, users, access_logs.
  4. Drop the obsolete GLOBAL unique index on products.sku (it becomes
     unique per company) and apply the new index set.
  5. Mark the legacy organization APROVADA, so the existing owner keeps working.

Re-running is safe: documents that already carry an org_id are left alone.

Usage:
    cd /app/backend && python migrate_tenancy.py            # dry run, prints a plan
    cd /app/backend && python migrate_tenancy.py --apply    # performs it
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from lib.db import client, db, ensure_indexes

LEGACY_ORG_NAME = os.environ.get("LEGACY_ORG_NAME", "Minha Loja")
LEGACY_ADMIN_EMAIL = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
TENANT_COLLECTIONS = (
    "products",
    "sales",
    "stock_movements",
    "returns",
    "access_logs",
)
BACKUP_ROOT = Path("/app/backups")


def _json_default(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


async def backup() -> Path:
    """Full backup before any write. Returns the folder it was written to."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    target = BACKUP_ROOT / stamp
    target.mkdir(parents=True, exist_ok=True)

    if shutil.which("mongodump"):
        result = subprocess.run(
            [
                "mongodump",
                f"--uri={os.environ['MONGO_URL']}",
                f"--db={os.environ['DB_NAME']}",
                f"--out={target}",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            print(f"  backup (mongodump) -> {target}")
            return target
        print(f"  mongodump falhou ({result.returncode}), caindo para dump JSON")

    names = await db.list_collection_names()
    for name in names:
        docs = await db[name].find().to_list(100000)
        for doc in docs:
            doc.pop("_id", None)
        (target / f"{name}.json").write_text(
            json.dumps(docs, default=_json_default, ensure_ascii=False, indent=1)
        )
    print(f"  backup (JSON, {len(names)} coleções) -> {target}")
    return target


async def plan() -> dict:
    counts = {}
    for name in TENANT_COLLECTIONS:
        total = await db[name].count_documents({})
        orphan = await db[name].count_documents(
            {"$or": [{"org_id": {"$exists": False}}, {"org_id": None}]}
        )
        counts[name] = {"total": total, "sem_org_id": orphan}
    users_total = await db.users.count_documents({})
    users_orphan = await db.users.count_documents(
        {
            "role": {"$ne": "PLATFORM_OWNER"},
            "$or": [{"org_id": {"$exists": False}}, {"org_id": None}],
        }
    )
    counts["users"] = {"total": users_total, "sem_org_id": users_orphan}
    counts["organizations"] = {"total": await db.organizations.count_documents({}), "sem_org_id": 0}
    return counts


async def migrate(apply: bool) -> None:
    print("=== Migração multiempresa (multi-tenant) ===")
    before = await plan()
    print("\nEstado atual:")
    for name, info in before.items():
        print(f"  {name:18} total={info['total']:<6} sem org_id={info['sem_org_id']}")

    if not apply:
        print("\nDRY RUN — nada foi alterado. Rode com --apply para executar.")
        return

    print("\n1) Backup do banco antes de qualquer escrita…")
    await backup()

    print("\n2) Empresa dos dados legados…")
    org = await db.organizations.find_one({"name": LEGACY_ORG_NAME})
    if org:
        print(f"  reutilizando empresa existente: {org['name']} ({org['id']})")
    else:
        legacy_admin = (
            await db.users.find_one({"email": LEGACY_ADMIN_EMAIL})
            if LEGACY_ADMIN_EMAIL
            else None
        )
        now = datetime.now(timezone.utc)
        org = {
            "id": str(uuid.uuid4()),
            "name": LEGACY_ORG_NAME,
            "owner_name": legacy_admin["name"] if legacy_admin else "Administrador",
            "owner_email": legacy_admin["email"] if legacy_admin else LEGACY_ADMIN_EMAIL,
            "status": "APROVADA",  # pre-existing customer must keep working
            "plan": "PROFISSIONAL",
            "subscription_status": "ATIVO",
            "trial_ends_at": now + timedelta(days=365),
            "created_at": now,
            "approved_at": now,
            "suspended_at": None,
            "notes": "Empresa criada pela migração multiempresa (dados anteriores ao SaaS).",
        }
        await db.organizations.insert_one(org)
        print(f"  empresa criada: {org['name']} ({org['id']})")

    org_id = org["id"]

    print("\n3) Preenchendo org_id nos registros legados…")
    for name in TENANT_COLLECTIONS:
        result = await db[name].update_many(
            {"$or": [{"org_id": {"$exists": False}}, {"org_id": None}]},
            {"$set": {"org_id": org_id}},
        )
        print(f"  {name:18} atualizados={result.modified_count}")

    result = await db.users.update_many(
        {
            "role": {"$ne": "PLATFORM_OWNER"},
            "$or": [{"org_id": {"$exists": False}}, {"org_id": None}],
        },
        {"$set": {"org_id": org_id}},
    )
    print(f"  {'users':18} atualizados={result.modified_count}")

    print("\n4) Índices: removendo SKU único global e aplicando o novo conjunto…")
    try:
        existing = await db.products.index_information()
        for legacy in ("sku_1", "sku", "category_name", "name_asc"):
            if legacy in existing:
                await db.products.drop_index(legacy)
                print(f"  índice removido: products.{legacy}")
    except Exception as exc:  # noqa: BLE001
        print(f"  aviso ao remover índices antigos: {exc}")
    await ensure_indexes()
    print("  novo conjunto de índices aplicado (SKU único por empresa)")

    print("\n5) Conferência final:")
    after = await plan()
    for name, info in after.items():
        flag = "OK" if info["sem_org_id"] == 0 else "ATENÇÃO"
        print(f"  {name:18} total={info['total']:<6} sem org_id={info['sem_org_id']}  [{flag}]")

    orphans = sum(
        info["sem_org_id"] for name, info in after.items() if name != "organizations"
    )
    print(
        "\nMigração concluída sem registros órfãos."
        if orphans == 0
        else f"\nAinda restam {orphans} registros sem empresa — verifique antes de seguir."
    )


if __name__ == "__main__":
    asyncio.run(migrate("--apply" in sys.argv))
    client.close()
