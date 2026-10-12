"""Backups do banco + registro de auditoria do proprietário.

Como funciona
-------------
* O backup lê o banco pelo próprio driver do app (motor) e grava um arquivo
  `.tar.gz` com um `.jsonl` (Extended JSON) por coleção. Não depende do binário
  `mongodump`, então funciona igual no preview e no banco gerenciado de produção.
* Sessões de login e links de redefinição de senha NÃO entram no backup: não
  servem para restaurar nada e só aumentariam o estrago de um arquivo vazado.
* O arquivo fica em BACKUP_DIR (os N mais recentes) e, se houver um armazenamento
  externo configurado (qualquer S3: Cloudflare R2, Backblaze B2, AWS S3), uma
  cópia é enviada para fora do servidor. Sem cópia externa, um problema no
  servidor leva os backups junto — o painel avisa quando ela não está ligada.
* Nada aqui bloqueia o servidor: leitura assíncrona e compressão/envio numa
  thread à parte, para o sistema continuar respondendo durante o backup.

Restauração: `python restore_backup.py --help` (empresa inteira ou banco todo).
"""

import asyncio
import io
import json
import logging
import os
import re
import tarfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from bson import json_util

from lib.db import db

logger = logging.getLogger(__name__)

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/app/backups"))
KEEP_BACKUPS = int(os.environ.get("BACKUP_KEEP", "7"))

# Never written to a backup file.
SKIP_COLLECTIONS = frozenset({"sessions", "password_resets"})

# Off-site copy (optional). Any S3-compatible storage works.
S3_BUCKET = os.environ.get("BACKUP_S3_BUCKET", "").strip()
S3_ENDPOINT = os.environ.get("BACKUP_S3_ENDPOINT", "").strip() or None
S3_REGION = os.environ.get("BACKUP_S3_REGION", "auto").strip() or "auto"
# Backblaze B2: a região vem no próprio endereço (s3.us-east-005.backblazeb2.com)
if S3_REGION == "auto" and S3_ENDPOINT and "backblazeb2.com" in S3_ENDPOINT:
    _m = re.search(r"s3\.([a-z0-9-]+)\.backblazeb2\.com", S3_ENDPOINT)
    if _m:
        S3_REGION = _m.group(1)
S3_PREFIX = os.environ.get("BACKUP_S3_PREFIX", "vendas-estoque/").strip()
S3_KEY_ID = os.environ.get("BACKUP_S3_ACCESS_KEY_ID", "").strip()
S3_SECRET = os.environ.get("BACKUP_S3_SECRET_ACCESS_KEY", "").strip()


def offsite_configured() -> bool:
    return bool(S3_BUCKET and S3_KEY_ID and S3_SECRET)


# ----------------------------------------------------------------- auditoria
async def log_platform_action(
    *, actor_email: str, action: str, target: str = "", details: str = ""
) -> None:
    """Trilha de auditoria das ações do dono da plataforma (quem fez o quê, quando)."""
    await db.platform_logs.insert_one(
        {
            "id": str(uuid.uuid4()),
            "actor_email": actor_email,
            "action": action,
            "target": target,
            "details": details,
            "created_at": datetime.now(timezone.utc),
        }
    )


# ------------------------------------------------------------------- backups
def _prune() -> None:
    files = sorted(BACKUP_DIR.glob("auto-*.tar.gz"), key=lambda p: p.name, reverse=True)
    for stale in files[KEEP_BACKUPS:]:
        stale.unlink(missing_ok=True)


async def _dump_collections() -> dict[str, bytes]:
    """Every collection (except SKIP_COLLECTIONS) as Extended JSON lines."""
    dumped: dict[str, bytes] = {}
    names = sorted(await db.list_collection_names())
    for name in names:
        if name in SKIP_COLLECTIONS or name.startswith("system."):
            continue
        buffer = io.BytesIO()
        async for doc in db[name].find({}):
            buffer.write(json_util.dumps(doc, json_options=json_util.CANONICAL_JSON_OPTIONS).encode())
            buffer.write(b"\n")
        dumped[name] = buffer.getvalue()
    return dumped


def _write_archive(archive: Path, stamp: str, dumped: dict[str, bytes]) -> int:
    """Blocking part (compression) — runs in a worker thread."""
    manifest = {
        "format": "jsonl-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "collections": {name: data.count(b"\n") for name, data in dumped.items()},
    }
    tmp = archive.with_suffix(".partial")
    with tarfile.open(tmp, "w:gz") as tar:
        files = {"manifest.json": json.dumps(manifest, indent=2).encode()}
        files.update({f"{name}.jsonl": data for name, data in dumped.items()})
        for file_name, data in files.items():
            info = tarfile.TarInfo(name=f"backup-{stamp}/{file_name}")
            info.size = len(data)
            info.mtime = int(datetime.now(timezone.utc).timestamp())
            tar.addfile(info, io.BytesIO(data))
    tmp.replace(archive)  # the file only appears once it is complete
    return archive.stat().st_size


def _upload_offsite(archive: Path) -> None:
    """Blocking part (network) — runs in a worker thread."""
    import boto3  # imported lazily: only needed when off-site copies are on

    client = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        region_name=S3_REGION,
        aws_access_key_id=S3_KEY_ID,
        aws_secret_access_key=S3_SECRET,
    )
    client.upload_file(str(archive), S3_BUCKET, f"{S3_PREFIX}{archive.name}")


async def run_backup() -> dict:
    """Banco -> tar.gz em BACKUP_DIR (+ cópia externa), mantendo os últimos KEEP_BACKUPS."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    archive = BACKUP_DIR / f"auto-{stamp}.tar.gz"

    try:
        dumped = await _dump_collections()
        size = await asyncio.to_thread(_write_archive, archive, stamp, dumped)
    except Exception as exc:  # noqa: BLE001 — registramos a falha e seguimos
        logger.error("Backup falhou: %s", exc)
        await db.backups.insert_one(
            {
                "id": str(uuid.uuid4()),
                "file": archive.name,
                "size_bytes": 0,
                "status": "FALHOU",
                "error": str(exc)[:300],
                "offsite": "",
                "created_at": datetime.now(timezone.utc),
            }
        )
        return {"status": "FALHOU", "error": str(exc)[:300]}

    offsite = "NAO_CONFIGURADO"
    offsite_error = ""
    if offsite_configured():
        try:
            await asyncio.to_thread(_upload_offsite, archive)
            offsite = "ENVIADO"
        except Exception as exc:  # noqa: BLE001 — local copy is still good
            offsite = "FALHOU"
            offsite_error = f"Cópia externa falhou: {str(exc)[:200]}"
            logger.error("Envio do backup para o armazenamento externo falhou: %s", exc)

    _prune()
    await db.backups.insert_one(
        {
            "id": str(uuid.uuid4()),
            "file": archive.name,
            "size_bytes": size,
            "status": "OK",
            "error": offsite_error,
            "offsite": offsite,
            "created_at": datetime.now(timezone.utc),
        }
    )
    logger.info("Backup concluído: %s (%s bytes, externo: %s)", archive.name, size, offsite)
    return {"status": "OK", "file": archive.name, "size_bytes": size, "offsite": offsite}


def backup_path(file_name: str) -> Path:
    """Resolve um nome de arquivo de backup sem permitir sair da pasta."""
    safe = Path(file_name).name
    path = (BACKUP_DIR / safe).resolve()
    if path.parent != BACKUP_DIR.resolve() or not path.is_file():
        raise FileNotFoundError(file_name)
    return path
