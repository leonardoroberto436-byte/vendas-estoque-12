"""Credenciais de teste vêm SOMENTE do ambiente — nada fixo no repositório."""

import os

import pytest


def env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        pytest.skip(f"{name} não definido no ambiente", allow_module_level=True)
    return value
