"""Auth routes — mounted under /api/auth.

Public: signup, login, forgot-password, reset-password.
Session rides an httpOnly cookie; the org is never accepted from the client.
"""

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response

from lib.auth import (
    RESET_TOKEN_MINUTES,
    Principal,
    create_session,
    destroy_session,
    get_current_user,
    hash_password,
    hash_token,
    verify_password,
)
from lib.db import db
from lib.email import send_password_reset, send_signup_pending
from models.org import (
    TRIAL_DAYS,
    ForgotPasswordRequest,
    OrgSummary,
    Organization,
    PLAN_LABELS,
    ResetPasswordRequest,
    SignupRequest,
    SignupResponse,
)
from models.users import AccessLog, LoginRequest, PasswordChange, SessionUser, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _log_access(
    request: Request, event: str, email: str, user: dict | None = None
) -> None:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = (
        forwarded.split(",")[0].strip()
        if forwarded
        else (request.client.host if request.client else "")
    )
    entry = AccessLog(
        user_id=user["id"] if user else None,
        org_id=user.get("org_id") if user else None,
        user_name=user["name"] if user else "—",
        email=email,
        role=user["role"] if user else None,
        event=event,  # type: ignore[arg-type]
        ip=ip,
        user_agent=request.headers.get("user-agent", "")[:240],
    )
    await db.access_logs.insert_one(entry.model_dump())


def _org_summary(org: dict | None) -> OrgSummary | None:
    if not org:
        return None
    trial_ends = _aware(org.get("trial_ends_at"))
    days_left = None
    if trial_ends:
        days_left = max(0, (trial_ends - datetime.now(timezone.utc)).days)
    return OrgSummary(
        id=org["id"],
        name=org["name"],
        status=org["status"],
        plan=org["plan"],
        plan_label=PLAN_LABELS.get(org["plan"], org["plan"]),
        subscription_status=org["subscription_status"],
        trial_ends_at=trial_ends,
        trial_days_left=days_left,
    )


def _session_user(user: dict, org: dict | None) -> SessionUser:
    return SessionUser(
        id=user["id"],
        name=user["name"],
        email=user["email"],
        role=user["role"],
        is_active=user.get("is_active", False),
        org_id=user.get("org_id"),
        created_at=_aware(user["created_at"]),
        last_login_at=_aware(user.get("last_login_at")),
        organization=_org_summary(org),
    )


# ------------------------------------------------------------------- signup
@router.post("/signup", response_model=SignupResponse, status_code=201)
async def signup(payload: SignupRequest, request: Request):
    """Self-service signup: creates the company as PENDENTE plus its first admin.

    The company stays unusable until the platform owner approves it, so a signup
    can never read data or occupy a paid seat on its own.
    """
    email = payload.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.")

    org = Organization(
        name=payload.company_name.strip(),
        owner_name=payload.name.strip(),
        owner_email=email,
        status="PENDENTE",
        plan="TESTE",
        subscription_status="TESTE",
    )
    await db.organizations.insert_one(org.model_dump())

    user = User(
        name=payload.name.strip(),
        email=email,
        role="ADMIN",
        org_id=org.id,
        is_active=True,
    )
    await db.users.insert_one(
        {**user.model_dump(), "password_hash": hash_password(payload.password)}
    )
    await _log_access(request, "CADASTRO", email, {**user.model_dump()})

    try:
        await send_signup_pending(to=email, name=user.name, company=org.name)
    except HTTPException as exc:  # email outage must not void a valid signup
        logger.warning("Signup email não enviado para %s: %s", email, exc.detail)

    return SignupResponse(
        organization_id=org.id,
        company_name=org.name,
        status=org.status,
        message=(
            "Cadastro recebido. Sua empresa está aguardando liberação — "
            "avisamos por e-mail assim que o acesso for aprovado."
        ),
    )


# -------------------------------------------------------------------- login
@router.post("/login", response_model=SessionUser)
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

    org = None
    if user["role"] != "PLATFORM_OWNER":
        org = await db.organizations.find_one({"id": user.get("org_id")})
        if not org:
            await _log_access(request, "LOGIN_BLOQUEADO", email, user)
            raise HTTPException(status_code=403, detail="Usuário sem empresa vinculada.")
        if org["status"] == "PENDENTE":
            await _log_access(request, "LOGIN_BLOQUEADO", email, user)
            raise HTTPException(
                status_code=403,
                detail="Sua empresa está aguardando liberação. Avisamos por e-mail quando aprovada.",
            )
        if org["status"] == "SUSPENSA":
            await _log_access(request, "LOGIN_BLOQUEADO", email, user)
            raise HTTPException(
                status_code=403, detail="O acesso da sua empresa está suspenso. Fale com o suporte."
            )
        if org["subscription_status"] == "CANCELADO":
            await _log_access(request, "LOGIN_BLOQUEADO", email, user)
            raise HTTPException(
                status_code=403, detail="Assinatura cancelada. Fale com o suporte para reativar."
            )

    now = datetime.now(timezone.utc)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now}})
    await create_session(user["id"], response)
    await _log_access(request, "LOGIN_OK", email, user)
    return _session_user({**user, "last_login_at": now}, org)


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


@router.get("/me", response_model=SessionUser)
async def me(principal: Principal = Depends(get_current_user)):
    user = await db.users.find_one({"id": principal.id})
    if not user:
        raise HTTPException(status_code=401, detail="Sessão inválida.")
    org = (
        await db.organizations.find_one({"id": user.get("org_id")})
        if user.get("org_id")
        else None
    )
    return _session_user(user, org)


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


# --------------------------------------------------------- password recovery
@router.post("/forgot-password", status_code=202)
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    """Always answers the same way — an attacker learns nothing about who exists."""
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email})
    generic = {
        "message": (
            "Se existir uma conta com este e-mail, enviamos um link para criar uma nova senha. "
            "O link expira em 30 minutos."
        )
    }

    if user and user.get("is_active", False):
        token = secrets.token_urlsafe(32)
        await db.password_resets.delete_many({"user_id": user["id"], "used_at": None})
        await db.password_resets.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user["id"],
                "token_hash": hash_token(token),  # only the hash is stored
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc)
                + timedelta(minutes=RESET_TOKEN_MINUTES),
                "used_at": None,
            }
        )
        try:
            await send_password_reset(
                to=user["email"],
                name=user["name"],
                token=token,
                minutes=RESET_TOKEN_MINUTES,
            )
            await _log_access(request, "RESET_SOLICITADO", email, user)
        except HTTPException as exc:
            logger.warning("Reset email não enviado para %s: %s", email, exc.detail)

    return generic


@router.post("/reset-password", status_code=204)
async def reset_password(payload: ResetPasswordRequest, request: Request):
    """Single-use token: consumed on success and all sessions are revoked."""
    record = await db.password_resets.find_one(
        {"token_hash": hash_token(payload.token), "used_at": None}
    )
    if not record:
        raise HTTPException(status_code=400, detail="Link inválido ou já utilizado.")

    expires = _aware(record["expires_at"])
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Link expirado. Solicite um novo.")

    user = await db.users.find_one({"id": record["user_id"]})
    if not user or not user.get("is_active", False):
        raise HTTPException(status_code=400, detail="Conta indisponível. Fale com o administrador.")

    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"password_hash": hash_password(payload.password)}}
    )
    await db.password_resets.update_one(
        {"id": record["id"]}, {"$set": {"used_at": datetime.now(timezone.utc)}}
    )
    await db.sessions.delete_many({"user_id": user["id"]})
    await _log_access(request, "RESET_CONCLUIDO", user["email"], user)
    return None
