"""Política de senha — um único lugar para validar toda troca de senha.

Nasceu de um incidente real: a senha de um administrador vazou num chat externo,
foi rotacionada e, na redefinição, o próprio usuário escolheu de novo a senha
vazada. Reutilizar a senha atual (ou uma conhecidamente vazada) agora é recusado.
"""

import os
import re

from fastapi import HTTPException

from lib.auth import verify_password

MIN_LENGTH = 10

# Senhas que circularam fora do sistema e não podem voltar a ser usadas.
# Configurável por ambiente para não fixar segredo no código.
_BLOCKED = {
    value.strip().lower()
    for value in os.environ.get("BLOCKED_PASSWORDS", "").split(",")
    if value.strip()
}


def validate_new_password(new_password: str, *, current_hash: str | None = None) -> None:
    """Recusa senha fraca, igual à atual ou conhecidamente vazada."""
    password = new_password.strip()

    if len(password) < MIN_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"A senha precisa ter pelo menos {MIN_LENGTH} caracteres.",
        )
    if not re.search(r"[A-Za-zÀ-ÿ]", password) or not re.search(r"\d", password):
        raise HTTPException(
            status_code=400,
            detail="A senha precisa misturar letras e números.",
        )
    if password.lower() in _BLOCKED:
        raise HTTPException(
            status_code=400,
            detail=(
                "Esta senha já foi exposta fora do sistema e não pode ser usada. "
                "Escolha uma senha nova."
            ),
        )
    if current_hash and verify_password(password, current_hash):
        raise HTTPException(
            status_code=400,
            detail="A nova senha precisa ser diferente da senha atual.",
        )
