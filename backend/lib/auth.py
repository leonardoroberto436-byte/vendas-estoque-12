"""Authentication + authorization.

Single shared org, two role levels (Step 0: Layer 1 only — no tenancy, no
per-object ownership). Sessions are opaque tokens in Mongo, carried by an
httpOnly cookie; the principal is always re-read from the DB so a deactivated
or demoted user stops working on the next request, not at token expiry.
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
_PBKDF2_ROUNDS = 240_000

ROLE_ADMIN = "ADMIN"
ROLE_OPERADOR = "OPERADOR"
ROLES = (ROLE_ADMIN, ROLE_OPERADOR)

# Deny-by-default permission table. Operators run the shop; only admins touch accounts.
_SHOP_ACTIONS = frozenset(
    {
        "shop:read",
        "shop:write",
        "sales:create",
        "stock:write",
        "products:write",
        "reports:read",
    }
)
PERMISSIONS: dict[str, frozenset[str]] = {
    ROLE_ADMIN: _SHOP_ACTIONS | frozenset({"users:manage"}),
    ROLE_OPERADOR: _SHOP_ACTIONS,
}


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

    def __init__(self, id: str, name: str, email: str, role: str) -> None:
        self.id = id
        self.name = name
        self.email = email
        self.role = role


async def get_current_user(ev_session: str | None = Cookie(default=None)) -> Principal:
    """Server-derived principal — never read role/identity from the request body."""
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

    # re-read the source of truth: a revoked/demoted account must fail now
    user = await db.users.find_one({"id": session["user_id"]})
    if not user or not user.get("is_active", False):
        raise HTTPException(status_code=403, detail="Acesso bloqueado pelo administrador.")

    return Principal(id=user["id"], name=user["name"], email=user["email"], role=user["role"])


def authorize(principal: Principal, action: str) -> bool:
    """The one decision function — no explicit allow means deny."""
    return action in PERMISSIONS.get(principal.role, frozenset())


def require(action: str):
    """Route dependency: `dependencies=[Depends(require("users:manage"))]`."""

    async def dependency(principal: Principal = Depends(get_current_user)) -> Principal:
        if not authorize(principal, action):
            raise HTTPException(
                status_code=403, detail="Seu perfil não tem permissão para esta ação."
            )
        return principal

    return dependency


# -------------------------------------------------------------- bootstrapping
async def ensure_bootstrap_admin() -> None:
    """Create the owner account from env on first boot; never overwrite an existing one."""
    email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD") or ""
    if not email or not password:
        return
    existing = await db.users.find_one({"email": email})
    if existing:
        return
    await db.users.insert_one(
        {
            "id": str(uuid.uuid4()),
            "name": os.environ.get("ADMIN_NAME", "Administrador"),
            "email": email,
            "role": ROLE_ADMIN,
            "is_active": True,
            "password_hash": hash_password(password),
            "created_at": datetime.now(timezone.utc),
            "last_login_at": None,
        }
    )
