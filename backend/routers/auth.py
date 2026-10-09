"""Auth routes — mounted under /api/auth. Session rides an httpOnly cookie."""

from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response

from lib.auth import (
    Principal,
    create_session,
    destroy_session,
    get_current_user,
    hash_password,
    verify_password,
)
from lib.db import db
from models.users import AccessLog, LoginRequest, PasswordChange, User

router = APIRouter(prefix="/auth", tags=["auth"])


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _log_access(
    request: Request,
    event: str,
    email: str,
    user: dict | None = None,
) -> None:
    """Append-only access trail the admin panel reads. Never blocks the response."""
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
    entry = AccessLog(
        user_id=user["id"] if user else None,
        user_name=user["name"] if user else "—",
        email=email,
        role=user["role"] if user else None,
        event=event,  # type: ignore[arg-type]
        ip=ip,
        user_agent=request.headers.get("user-agent", "")[:240],
    )
    await db.access_logs.insert_one(entry.model_dump())


@router.post("/login", response_model=User)
async def login(payload: LoginRequest, request: Request, response: Response):
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email})
    # same message for unknown email and wrong password — no account enumeration
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        await _log_access(request, "LOGIN_FALHOU", email, user)
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
    if not user.get("is_active", False):
        await _log_access(request, "LOGIN_BLOQUEADO", email, user)
        raise HTTPException(
            status_code=403, detail="Seu acesso está desativado. Fale com o administrador."
        )

    now = datetime.now(timezone.utc)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now}})
    await create_session(user["id"], response)
    await _log_access(request, "LOGIN_OK", email, user)
    return User(
        id=user["id"],
        name=user["name"],
        email=user["email"],
        role=user["role"],
        is_active=True,
        created_at=_aware(user["created_at"]),
        last_login_at=now,
    )


@router.post("/logout", status_code=204)
async def logout(
    request: Request, response: Response, ev_session: str | None = Cookie(default=None)
):
    session = await db.sessions.find_one({"token": ev_session}) if ev_session else None
    if session:
        user = await db.users.find_one({"id": session["user_id"]})
        if user:
            await _log_access(request, "LOGOUT", user["email"], user)
    await destroy_session(ev_session, response)
    return None


@router.get("/me", response_model=User)
async def me(principal: Principal = Depends(get_current_user)):
    user = await db.users.find_one({"id": principal.id})
    if not user:
        raise HTTPException(status_code=401, detail="Sessão inválida.")
    return User(
        id=user["id"],
        name=user["name"],
        email=user["email"],
        role=user["role"],
        is_active=user.get("is_active", False),
        created_at=_aware(user["created_at"]),
        last_login_at=_aware(user.get("last_login_at")),
    )


@router.post("/change-password", status_code=204)
async def change_password(
    payload: PasswordChange, principal: Principal = Depends(get_current_user)
):
    user = await db.users.find_one({"id": principal.id})
    if not user or not verify_password(payload.current_password, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Senha atual incorreta.")
    await db.users.update_one(
        {"id": principal.id}, {"$set": {"password_hash": hash_password(payload.new_password)}}
    )
    return None
