"""Dados públicos dos Termos de Uso e da Política de Privacidade — /api/legal.

O texto fica no front (páginas /termos e /privacidade); daqui vêm só os dados de
quem presta o serviço, configurados por variável de ambiente para não ficarem
fixos no código:
LEGAL_COMPANY_NAME, LEGAL_DOCUMENT (CNPJ/CPF), LEGAL_CONTACT_EMAIL, LEGAL_CITY.
"""

import os

from fastapi import APIRouter
from pydantic import BaseModel

from lib.email import EMAIL_FROM_NAME

router = APIRouter(prefix="/legal", tags=["legal"])

# Mude a versão sempre que o texto dos termos mudar: o aceite fica gravado com ela.
TERMS_VERSION = "2026-10-10"


class LegalInfo(BaseModel):
    product_name: str
    company_name: str
    document: str
    contact_email: str
    city: str
    version: str


def legal_info() -> LegalInfo:
    product = EMAIL_FROM_NAME
    return LegalInfo(
        product_name=product,
        company_name=os.environ.get("LEGAL_COMPANY_NAME", "").strip() or product,
        document=os.environ.get("LEGAL_DOCUMENT", "").strip(),
        contact_email=(
            os.environ.get("LEGAL_CONTACT_EMAIL", "").strip()
            or os.environ.get("EMAIL_REPLY_TO", "").strip()
        ),
        city=os.environ.get("LEGAL_CITY", "").strip(),
        version=TERMS_VERSION,
    )


@router.get("", response_model=LegalInfo)
async def get_legal_info():
    return legal_info()
