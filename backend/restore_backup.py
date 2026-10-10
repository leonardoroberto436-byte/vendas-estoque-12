"""Restaura um backup gerado por lib/backups.py.

Dois modos:

* Uma empresa só (o caso comum — "a loja X perdeu dados"):
      python restore_backup.py ARQUIVO.tar.gz --org ID_DA_EMPRESA
  Devolve ao banco os registros dessa empresa que estão no backup (empresa,
  usuários, produtos, vendas, devoluções, movimentos, logs). Registros com o
  mesmo `id` são substituídos pela versão do backup; registros criados depois
  do backup NÃO são apagados.

* O banco inteiro (desastre):
      python restore_backup.py ARQUIVO.tar.gz --all

Por padrão só SIMULA e mostra o que faria. Para gravar de verdade, acrescente
--yes. Antes de gravar, um backup novo do estado atual é feito automaticamente,
para dar para voltar atrás.

Também aceita backups antigos no formato do mongodump (pastas com .bson).
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from lib.backups import run_backup  # noqa: E402
from lib.restore import read_archive, select_org, write  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("archive", type=Path, help="arquivo .tar.gz do backup")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--org", help="id da empresa a restaurar")
    target.add_argument("--all", action="store_true", help="restaurar o banco inteiro")
    parser.add_argument("--yes", action="store_true", help="gravar de verdade (sem isso, só simula)")
    args = parser.parse_args()

    data = read_archive(args.archive)
    plan = select_org(data, args.org) if args.org else data
    if args.org and not plan["organizations"]:
        print(f"Empresa {args.org} não está neste backup. Nada a fazer.")
        return 1

    print(f"Backup: {args.archive.name}")
    for name, docs in sorted(plan.items()):
        print(f"  {name:<18} {len(docs):>6} registros")

    if not args.yes:
        print("\nSIMULAÇÃO — nada foi gravado. Rode de novo com --yes para restaurar.")
        return 0

    safety = await run_backup()
    print(f"Backup de segurança do estado atual: {json.dumps(safety, ensure_ascii=False)}")
    if safety.get("status") != "OK":
        print("Backup de segurança falhou — restauração cancelada.")
        return 2

    await write(plan)
    print("Restauração concluída.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
