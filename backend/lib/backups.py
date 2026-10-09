"""Backups automáticos do banco + registro de auditoria do proprietário.

O backup roda via cron (routers/cron.py) com `mongodump`, guarda um arquivo
.tar.gz em /app/backups e mantém apenas os N mais recentes. O arquivo fica no
disco do servidor; para guarda externa o proprietário baixa pelo painel.
"""

import logging
import os
import shutil
import subprocess
import tarfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from lib.db import db

logger = logging.getLogger(__name__)

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/app/backups"))
KEEP_BACKUPS = int(os.environ.get("BACKUP_KEEP", "7"))


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


async def run_backup() -> dict:
    """mongodump -> tar.gz em /app/backups, mantendo os últimos KEEP_BACKUPS."""
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    work = BACKUP_DIR / f"tmp-{stamp}"
    archive = BACKUP_DIR / f"auto-{stamp}.tar.gz"

    try:
        proc = subprocess.run(
            ["mongodump", f"--uri={mongo_url}", f"--db={db_name}", f"--out={work}", "--quiet"],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip()[:300] or "mongodump falhou")

        with tarfile.open(archive, "w:gz") as tar:
            tar.add(work, arcname=f"backup-{stamp}")
        size = archive.stat().st_size
    except Exception as exc:  # noqa: BLE001 — registramos a falha e seguimos
        logger.error("Backup falhou: %s", exc)
        await db.backups.insert_one(
            {
                "id": str(uuid.uuid4()),
                "file": archive.name,
                "size_bytes": 0,
                "status": "FALHOU",
                "error": str(exc)[:300],
                "created_at": datetime.now(timezone.utc),
            }
        )
        return {"status": "FALHOU", "error": str(exc)[:300]}
    finally:
        shutil.rmtree(work, ignore_errors=True)

    _prune()
    await db.backups.insert_one(
        {
            "id": str(uuid.uuid4()),
            "file": archive.name,
            "size_bytes": size,
            "status": "OK",
            "error": "",
            "created_at": datetime.now(timezone.utc),
        }
    )
    logger.info("Backup concluído: %s (%s bytes)", archive.name, size)
    return {"status": "OK", "file": archive.name, "size_bytes": size}


def backup_path(file_name: str) -> Path:
    """Resolve um nome de arquivo de backup sem permitir sair da pasta."""
    safe = Path(file_name).name
    path = (BACKUP_DIR / safe).resolve()
    if path.parent != BACKUP_DIR.resolve() or not path.is_file():
        raise FileNotFoundError(file_name)
    return path
