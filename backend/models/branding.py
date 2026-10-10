"""Per-company branding shown on receipts and reports. Mirrors frontend/src/lib/types.ts."""

from typing import Optional

from pydantic import BaseModel, Field

LOGO_MAX_CHARS = 420_000  # ~300KB binary once base64-encoded


class OrgBranding(BaseModel):
    """What the POS receipt and the monthly report print as the company header."""

    trade_name: str = ""
    cnpj: str = ""
    phone: str = ""
    address: str = ""
    # data URL (data:image/png;base64,...) kept in Mongo with the org document
    logo: Optional[str] = None


class AlertSettings(BaseModel):
    """Liga/desliga dos alertas de estoque baixo/zerado da empresa."""

    low_stock_enabled: bool = True


class OrgBrandingUpdate(BaseModel):
    trade_name: str = Field(default="", max_length=120)
    cnpj: str = Field(default="", max_length=24)
    phone: str = Field(default="", max_length=24)
    address: str = Field(default="", max_length=160)
    logo: Optional[str] = Field(default=None, max_length=LOGO_MAX_CHARS)
