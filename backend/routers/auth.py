"""Auth routes — mounted under /api/auth.

Public: signup, login, forgot-password, reset-password.
Session rides an httpOnly cookie; the org is never accepted from the client.
"""

import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response

from lib.auth import (
    RESET_TOKEN_MINUTES,
    Principal,
    trial_expired,
    create_session,
    destroy_session,
    get_current_user,
    hash_password,
    hash_token,
    verify_password,
)
from lib.billing import BLOCK_MESSAGES, billing_block
from routers.legal import TERMS_VERSION
from lib.db import db
from lib.backups import log_platform_action
from lib.email import send_org_approved, send_owner_new_signup, send_password_reset
from lib.subscriptions import days_until
from lib.password_policy import validate_new_password
from lib.throttle import clear_throttle, client_ip, throttle
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
    ip = client_ip(request)  # same trusted-hop rule as the throttle — not spoofable
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
        trial_expired=trial_expired(org),
        billing_block=billing_block(org),
        due_date=_aware(org.get("due_date")),
        days_to_due=days_until(org.get("due_date")),
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

def login_limit() -> int:
    try:
        return max(1, int(os.environ.get("LOGIN_LIMIT_PER_5MIN", "8")))
    except ValueError:
        return 8

@router.post("/signup", response_model=SignupResponse, status_code=201)
async def signup(payload: SignupRequest, request: Request, response: Response):
    """Self-service signup: the company starts its free trial right away.

    Creates the company (APROVADA, plano TESTE por TRIAL_DAYS dias) and its first
    ADMIN, and signs the person in. Abuse is contained by the signup throttle, the
    plan limits of the trial and the owner, who can still suspend any company.
    """
    email = payload.email.strip().lower()
    # anti-abuso: limita cadastros por hora por IP — evita inundar o painel do
    # dono com empresas falsas e queimar a cota de e-mail transacional.
    # Ajustável por SIGNUP_LIMIT_PER_HOUR para rodar a suíte de testes.
    throttle(
        request,
        "signup",
        "global",
        limit=int(os.environ.get("SIGNUP_LIMIT_PER_HOUR", "30")),
        window=3600,
    )
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.")
    validate_new_password(payload.password)
    if not payload.accept_terms:
        raise HTTPException(
            status_code=400,
            detail="Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.",
        )
    accepted = {
        "terms_accepted_at": datetime.now(timezone.utc),
        "terms_version": TERMS_VERSION,
        "terms_accepted_ip": client_ip(request),
    }

    whatsapp = "".join(ch for ch in (payload.whatsapp or "") if ch.isdigit())
    if whatsapp and not 10 <= len(whatsapp) <= 13:
        raise HTTPException(status_code=400, detail="WhatsApp inválido. Use DDD + número, ex.: (19) 99999-9999.")

    now = datetime.now(timezone.utc)
    org = Organization(
        name=payload.company_name.strip(),
        owner_name=payload.name.strip(),
        owner_email=email,
        owner_whatsapp=whatsapp,
        status="APROVADA",
        plan="TESTE",
        subscription_status="TESTE",
        trial_ends_at=now + timedelta(days=TRIAL_DAYS),
        approved_at=now,
    )
    await db.organizations.insert_one({**org.model_dump(), **accepted})

    user = User(
        name=payload.name.strip(),
        email=email,
        role="ADMIN",
        org_id=org.id,
        is_active=True,
    )
    await db.users.insert_one(
        {**user.model_dump(), "password_hash": hash_password(payload.password), **accepted}
    )
    await _log_access(request, "CADASTRO", email, {**user.model_dump()})
    await log_platform_action(
        actor_email=email,
        action="CADASTRO_TESTE",
        target=org.name,
        details=f"teste grátis de {TRIAL_DAYS} dias · responsável {user.name}",
    )

    try:
        await send_org_approved(to=email, name=user.name, company=org.name, trial_days=TRIAL_DAYS)
    except HTTPException as exc:  # email outage must not void a valid signup
        logger.warning("Signup email não enviado para %s: %s", email, exc.detail)
    try:
        await send_owner_new_signup(
            company=org.name, name=user.name, email=email, whatsapp=whatsapp, trial_days=TRIAL_DAYS
        )
    except Exception as exc:  # aviso ao dono nunca bloqueia o cadastro
        logger.warning("Aviso de cadastro ao dono não enviado: %s", exc)

    # já entra logado: o teste começa na hora
    await create_session(user.id, response)
    return SignupResponse(
        organization_id=org.id,
        company_name=org.name,
        status=org.status,
        message=f"Conta criada! Seu teste grátis de {TRIAL_DAYS} dias já começou.",
    )


# -------------------------------------------------------------------- login
@router.post("/login", response_model=SessionUser)
async def login(payload: LoginRequest, request: Request, response: Response):
    email = payload.email.strip().lower()
    # brute-force brake: 8 tries per 5 min per IP+account, cleared on success
    # tentativas falhas por IP+conta; o acerto zera o contador. Ajustável por
    # LOGIN_LIMIT_PER_5MIN (a suíte de testes usa um valor maior).
    throttle(request, "login", email, limit=login_limit(), window=300)
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
        block = billing_block(org)
        if org["status"] == "SUSPENSA" and not block:
            await _log_access(request, "LOGIN_BLOQUEADO", email, user)
            raise HTTPException(
                status_code=403, detail="O acesso da sua empresa está suspenso. Fale com o suporte."
            )
        if block and user["role"] != "ADMIN":
            # só o administrador entra para regularizar a assinatura
            await _log_access(request, "LOGIN_BLOQUEADO", email, user)
            raise HTTPException(
                status_code=403,
                detail=f"{BLOCK_MESSAGES[block]} Fale com o administrador da loja.",
            )

    now = datetime.now(timezone.utc)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now}})
    clear_throttle("login", request, email)
    await create_session(user["id"], response)
    await _log_access(request, "LOGIN_OK", email, user)
    return _session_user({**user, "last_login_at": now}, org)


@router.post("/logout", status_code=204)
async def logout(
    request: Request, response: Response, ev_session: str | None = Cookie(default=None)
):
    session = (
        await db.sessions.find_one({"token_hash": hash_token(ev_session)})
        if ev_session
        else None
    )
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
    validate_new_password(payload.new_password, current_hash=user.get("password_hash", ""))
    await db.users.update_one(
        {"id": principal.id}, {"$set": {"password_hash": hash_password(payload.new_password)}}
    )
    return None


# --------------------------------------------------------- password recovery
@router.post("/forgot-password", status_code=202)
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    """Always answers the same way — an attacker learns nothing about who exists."""
    email = payload.email.strip().lower()
    throttle(request, "forgot", email, limit=5, window=900)
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
    # anti-força-bruta de token: 10 tentativas por 15 min por IP
    throttle(request, "reset", "global", limit=10, window=900)
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

    # o link não pode devolver a conta para a senha antiga/vazada
    validate_new_password(payload.password, current_hash=user.get("password_hash", ""))
    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"password_hash": hash_password(payload.password)}}
    )
    await db.password_resets.update_one(
        {"id": record["id"]}, {"$set": {"used_at": datetime.now(timezone.utc)}}
    )
    await db.sessions.delete_many({"user_id": user["id"]})
    await _log_access(request, "RESET_CONCLUIDO", user["email"], user)
    return None
