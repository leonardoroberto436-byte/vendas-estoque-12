"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "products": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        # SKU is unique PER COMPANY — a global unique index would let one tenant
        # block another tenant's product code.
        IndexModel([("org_id", ASCENDING), ("sku", ASCENDING)], name="org_sku", unique=True),
        IndexModel([("org_id", ASCENDING), ("name", ASCENDING)], name="org_name"),
        IndexModel([("org_id", ASCENDING), ("category", ASCENDING)], name="org_category"),
    ],
    "sales": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)], name="org_created"),
    ],
    "returns": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)], name="org_created"),
        IndexModel([("org_id", ASCENDING), ("sale_id", ASCENDING)], name="org_sale"),
    ],
    "stock_movements": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)], name="org_created"),
        IndexModel(
            [("org_id", ASCENDING), ("product_id", ASCENDING), ("created_at", DESCENDING)],
            name="org_product_created",
        ),
    ],
    "organizations": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
        IndexModel([("owner_email", ASCENDING)], name="owner_email"),
        IndexModel([("billing.mp_preapproval_id", ASCENDING)], name="mp_preapproval"),
    ],
    "billing_payments": [
        IndexModel([("mp_id", ASCENDING)], name="mp_id", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)], name="org_created"),
    ],
    "billing_events": [
        IndexModel([("created_at", DESCENDING)], name="created_desc"),
    ],
    "users": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("email", ASCENDING)], name="email", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", ASCENDING)], name="org_created"),
    ],
    "sessions": [
        # só o hash do token é guardado (ver lib/auth.create_session)
        IndexModel([("token_hash", ASCENDING)], name="token_hash", unique=True),
        IndexModel([("user_id", ASCENDING)], name="user_id"),
        IndexModel([("expires_at", ASCENDING)], name="expires_ttl", expireAfterSeconds=0),
    ],
    "password_resets": [
        IndexModel([("token_hash", ASCENDING)], name="token_hash", unique=True),
        IndexModel([("user_id", ASCENDING)], name="user_id"),
        IndexModel([("expires_at", ASCENDING)], name="expires_ttl", expireAfterSeconds=0),
    ],
    "access_logs": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("org_id", ASCENDING), ("created_at", DESCENDING)], name="org_created"),
        IndexModel([("created_at", DESCENDING)], name="created_desc"),
    ],
}


# Índices que existiram em versões anteriores e precisam sair do caminho.
# `sessions.token` era UNIQUE no token em texto puro; hoje guardamos só o hash
# (lib/auth.create_session), então todo documento novo teria token=null e o
# segundo login falharia com erro de chave duplicada.
STALE_INDEXES: dict[str, tuple[str, ...]] = {
    "sessions": ("token",),
}


async def drop_stale_indexes() -> None:
    """Migração idempotente: remove índices de versões antigas, se existirem."""
    for collection, names in STALE_INDEXES.items():
        try:
            existing = await db[collection].index_information()
        except Exception as exc:  # noqa: BLE001 — nunca travar o boot por causa de índice
            logger.error("drop_stale_indexes(%s): %s", collection, exc)
            continue
        for name in names:
            if name not in existing:
                continue
            try:
                await db[collection].drop_index(name)
                logger.warning("Índice obsoleto removido: %s.%s", collection, name)
            except Exception as exc:  # noqa: BLE001
                logger.error("drop_stale_indexes(%s.%s): %s", collection, name, exc)


async def ensure_indexes() -> None:
    await drop_stale_indexes()
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
