"""Leitura e restauração de backups (usado pelo painel do dono e pelo restore_backup.py)."""

import io
import tarfile
from pathlib import Path

import bson
from bson import json_util

from lib.backups import SKIP_COLLECTIONS
from lib.db import db

# Collections that belong to one company through `org_id`.
ORG_COLLECTIONS = ("users", "products", "sales", "returns", "stock_movements", "access_logs")


def read_archive(path: Path) -> dict[str, list[dict]]:
    """{collection: [documents]} from a jsonl-v1 backup or a legacy mongodump one."""
    data: dict[str, list[dict]] = {}
    with tarfile.open(path, "r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            name = Path(member.name).name
            raw = tar.extractfile(member)
            if raw is None:
                continue
            content = raw.read()
            if name.endswith(".jsonl"):
                docs = [json_util.loads(line) for line in content.splitlines() if line.strip()]
                data[name[: -len(".jsonl")]] = docs
            elif name.endswith(".bson"):
                data[name[: -len(".bson")]] = list(bson.decode_file_iter(io.BytesIO(content)))
    for skipped in SKIP_COLLECTIONS:
        data.pop(skipped, None)
    return data


def select_org(data: dict[str, list[dict]], org_id: str) -> dict[str, list[dict]]:
    picked = {"organizations": [d for d in data.get("organizations", []) if d.get("id") == org_id]}
    for name in ORG_COLLECTIONS:
        picked[name] = [d for d in data.get(name, []) if d.get("org_id") == org_id]
    return picked


async def write(plan: dict[str, list[dict]]) -> int:
    written = 0
    for name, docs in plan.items():
        for doc in docs:
            doc.pop("_id", None)
            key = {"id": doc["id"]} if "id" in doc else None
            if key:
                await db[name].replace_one(key, doc, upsert=True)
            else:
                await db[name].insert_one(doc)
            written += 1
    return written
