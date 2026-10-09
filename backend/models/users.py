"""User + auth models. Mirrors frontend/src/lib/types.ts.

Every user belongs to exactly one organization, except the PLATFORM_OWNER
(org_id is None) who administers the SaaS itself.
"""

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

from models.org import OrgSummary

Role = Literal["PLATFORM_OWNER", "ADMIN", "OPERADOR"]
CompanyRole = Literal["ADMIN", "OPERADOR"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: str
    role: Role
    org_id: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login_at: Optional[datetime] = None


class SessionUser(User):
    """What /auth/me and /auth/login return: the user plus their workspace."""

    organization: Optional[OrgSummary] = None


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    # A company admin can only mint company roles — never a platform owner.
    role: CompanyRole = "OPERADOR"
    is_active: bool = True


class UserUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    role: Optional[CompanyRole] = None
    is_active: Optional[bool] = None


class PasswordReset(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class AccessLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None
    org_id: Optional[str] = None
    user_name: str
    email: str
    role: Optional[Role] = None
    event: Literal[
        "LOGIN_OK",
        "LOGIN_FALHOU",
        "LOGIN_BLOQUEADO",
        "LOGOUT",
        "CADASTRO",
        "RESET_SOLICITADO",
        "RESET_CONCLUIDO",
    ]
    ip: str = ""
    user_agent: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
