"""Company branding — mounted under /api/settings.

Tenant-scoped: the branding always belongs to the caller's own organization
(`principal.org_id`), so one company can never read or overwrite another's logo.
Reading is open to any member (the POS needs it); writing is ADMIN only.
"""

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import Principal, require, require_org
from lib.db import db
from models.branding import LOGO_MAX_CHARS, OrgBranding, OrgBrandingUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

_ALLOWED_LOGO_PREFIXES = ("data:image/png;base64,", "data:image/jpeg;base64,")


def _branding(org: dict | None) -> OrgBranding:
    data = (org or {}).get("branding") or {}
    return OrgBranding(
        trade_name=data.get("trade_name") or (org or {}).get("name", ""),
        cnpj=data.get("cnpj", ""),
        phone=data.get("phone", ""),
        address=data.get("address", ""),
        logo=data.get("logo"),
    )


@router.get("/branding", response_model=OrgBranding)
async def get_branding(principal: Principal = Depends(require_org)):
    org = await db.organizations.find_one({"id": principal.org_id})
    return _branding(org)


@router.put("/branding", response_model=OrgBranding)
async def update_branding(
    payload: OrgBrandingUpdate, principal: Principal = Depends(require("users:manage"))
):
    if not principal.org_id:
        raise HTTPException(status_code=403, detail="Usuário sem empresa vinculada.")

    logo = payload.logo
    if logo:
        if not logo.startswith(_ALLOWED_LOGO_PREFIXES):
            raise HTTPException(status_code=400, detail="O logo deve ser uma imagem PNG ou JPG.")
        if len(logo) > LOGO_MAX_CHARS:
            raise HTTPException(status_code=413, detail="O logo deve ter no máximo 300 KB.")

    await db.organizations.update_one(
        {"id": principal.org_id},
        {
            "$set": {
                "branding": {
                    "trade_name": payload.trade_name.strip(),
                    "cnpj": payload.cnpj.strip(),
                    "phone": payload.phone.strip(),
                    "address": payload.address.strip(),
                    "logo": logo,
                }
            }
        },
    )
    org = await db.organizations.find_one({"id": principal.org_id})
    return _branding(org)
