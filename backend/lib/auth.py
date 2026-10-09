"""Authentication, authorization and tenant isolation.

Architecture (one decision point, deny by default):

* Layer 1 — role: PLATFORM_OWNER runs the SaaS, ADMIN runs one company,
  OPERADOR works in one company. `authorize(principal, action)` is the only
  place that answers "may this role do this?".
* Layer 2 — tenancy: every business row carries `org_id`. The org always comes
  from the session principal (`principal.org_id`), NEVER from the request body,
  query string or path. `scoped()` builds the query filter so a tenant-scoped
  read/write cannot be written without it.

A deactivated user, a suspended company or a cancelled subscription stops
working on the next request, because the principal is re-read from the DB every
time instead of being trusted from the token.
"""

import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, Response

from lib.db import db

SESSION_COOKIE = "ev_session"
SESSION_DAYS = 14
RESET_TOKEN_MINUTES = 30
_PBKDF2_ROUNDS = 240_000

ROLE_PLATFORM_OWNER = "PLATFORM_OWNER"
ROLE_ADMIN = "ADMIN"
ROLE_OPERADOR = "OPERADOR"
ROLES = (ROLE_PLATFORM_OWNER, ROLE_ADMIN, ROLE_OPERADOR)

# Deny-by-default permission table.
_SHOP_ACTIONS = frozenset(
    {
        "shop:read",
        "shop:write",
        "sales:create",
        "returns:create",
        "stock:write",
        "products:write",
        "reports:read",
    }
)
PERMISSIONS: dict[str, frozenset[str]] = {
    # The SaaS owner administers the platform; they do not operate a customer's shop.
    ROLE_PLATFORM_OWNER: frozenset({"platform:manage"}),
    ROLE_ADMIN: _SHOP_ACTIONS | frozenset({"users:manage"}),
    ROLE_OPERADOR: _SHOP_ACTIONS,
}

# Subscription states that still allow working in the app.
_LIVE_SUBSCRIPTIONS = frozenset({"TESTE", "ATIVO", "INADIMPLENTE"})


# ----------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, rounds, salt, expected = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(rounds)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), expected)


def hash_token(token: str) -> str:
    """Reset tokens are stored hashed — a DB leak must not hand over live links."""
    return hashlib.sha256(token.encode()).hexdigest()


# ------------------------------------------------------------------ sessions
async def create_session(user_id: str, response: Response) -> str:
    token = secrets.token_urlsafe(32)
    await db.sessions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "token": token,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
        }
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return token


async def destroy_session(token: str | None, response: Response) -> None:
    if token:
        await db.sessions.delete_many({"token": token})
    response.delete_cookie(SESSION_COOKIE, path="/")


# ----------------------------------------------------------------- principal
class Principal:
    id: str
    name: str
    email: str
    role: str
    org_id: str | None
    org_name: str

    def __init__(
        self,
        id: str,
        name: str,
        email: str,
        role: str,
        org_id: str | None = None,
        org_name: str = "",
    ) -> None:
        self.id = id
        self.name = name
        self.email = email
        self.role = role
        self.org_id = org_id
        self.org_name = org_name

    @property
    def is_platform_owner(self) -> bool:
        return self.role == ROLE_PLATFORM_OWNER


async def get_current_user(ev_session: str | None = Cookie(default=None)) -> Principal:
    """Server-derived principal. Identity, role AND org all come from the DB."""
    if not ev_session:
        raise HTTPException(status_code=401, detail="Sessão expirada. Faça login novamente.")

    session = await db.sessions.find_one({"token": ev_session})
    if not session:
        raise HTTPException(status_code=401, detail="Sessão inválida. Faça login novamente.")

    expires = session["expires_at"]
    if isinstance(expires, datetime) and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        await db.sessions.delete_many({"token": ev_session})
        raise HTTPException(status_code=401, detail="Sessão expirada. Faça login novamente.")

    user = await db.users.find_one({"id": session["user_id"]})
    if not user or not user.get("is_active", False):
        raise HTTPException(status_code=403, detail="Acesso bloqueado pelo administrador.")

    org_name = ""
    org_id = user.get("org_id")
    if user["role"] != ROLE_PLATFORM_OWNER:
        if not org_id:
            raise HTTPException(status_code=403, detail="Usuário sem empresa vinculada.")
        org = await db.organizations.find_one({"id": org_id})
        if not org:
            raise HTTPException(status_code=403, detail="Empresa não encontrada.")
        if org.get("status") != "APROVADA":
            detail = (
                "Sua empresa está aguardando liberação do administrador da plataforma."
                if org.get("status") == "PENDENTE"
                else "O acesso da sua empresa está suspenso. Fale com o suporte."
            )
            raise HTTPException(status_code=403, detail=detail)
        if org.get("subscription_status") not in _LIVE_SUBSCRIPTIONS:
            raise HTTPException(
                status_code=403, detail="Assinatura cancelada. Fale com o suporte para reativar."
            )
        org_name = org.get("name", "")

    return Principal(
        id=user["id"],
        name=user["name"],
        email=user["email"],
        role=user["role"],
        org_id=org_id,
        org_name=org_name,
    )


def authorize(principal: Principal, action: str) -> bool:
    """The one decision function — no explicit allow means deny."""
    return action in PERMISSIONS.get(principal.role, frozenset())


def require(action: str):
    """Route dependency: `Depends(require("products:write"))`."""

    async def dependency(principal: Principal = Depends(get_current_user)) -> Principal:
        if not authorize(principal, action):
            raise HTTPException(
                status_code=403, detail="Seu perfil não tem permissão para esta ação."
            )
        return principal

    return dependency


# ------------------------------------------------------------------- tenancy
async def require_org(principal: Principal = Depends(get_current_user)) -> Principal:
    """Tenant-scoped routes depend on this: guarantees a usable org_id exists.

    The platform owner is intentionally rejected here — they administer
    companies, they do not read or write inside a customer's workspace.
    """
    if principal.is_platform_owner or not principal.org_id:
        raise HTTPException(
            status_code=403,
            detail="Esta área pertence a uma empresa cliente. Use o painel da plataforma.",
        )
    return principal


def scoped(principal: Principal, extra: dict | None = None) -> dict:
    """Build a Mongo filter already pinned to the caller's company.

    Every tenant-scoped query goes through here, so no query can be written that
    forgets the org filter — including lookups by id, which is what stops one
    company from reading another's row by guessing/replaying an id.
    """
    if not principal.org_id:
        raise HTTPException(status_code=403, detail="Usuário sem empresa vinculada.")
    query: dict = {"org_id": principal.org_id}
    if extra:
        query.update(extra)
    return query


# -------------------------------------------------------------- bootstrapping
async def ensure_bootstrap_accounts() -> None:
    """Create the platform-owner account from env on first boot. Never overwrites."""
    email = (os.environ.get("PLATFORM_OWNER_EMAIL") or "").strip().lower()
    password = os.environ.get("PLATFORM_OWNER_PASSWORD") or ""
    if not email or not password:
        return
    if await db.users.find_one({"email": email}):
        return
    await db.users.insert_one(
        {
            "id": str(uuid.uuid4()),
            "name": os.environ.get("PLATFORM_OWNER_NAME", "Dono da Plataforma"),
            "email": email,
            "role": ROLE_PLATFORM_OWNER,
            "org_id": None,
            "is_active": True,
            "password_hash": hash_password(password),
            "created_at": datetime.now(timezone.utc),
            "last_login_at": None,
        }
    )
