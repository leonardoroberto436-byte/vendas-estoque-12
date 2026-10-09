"""Admin-only user management — mounted under /api/users.

Every route in this module requires the `users:manage` permission, so only
ADMIN principals reach it. Role/active flags are never mass-assigned from the
request body — each field is read off the validated model explicitly.
"""

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import Principal, hash_password, require
from lib.db import db
from models.users import PasswordReset, User, UserCreate, UserUpdate

router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(require("users:manage"))],
)


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _to_model(doc: dict) -> User:
    return User(
        id=doc["id"],
        name=doc["name"],
        email=doc["email"],
        role=doc["role"],
        is_active=doc.get("is_active", False),
        created_at=_aware(doc["created_at"]),
        last_login_at=_aware(doc.get("last_login_at")),
    )


async def _admin_count() -> int:
    return await db.users.count_documents({"role": "ADMIN", "is_active": True})


@router.get("", response_model=List[User])
async def list_users():
    docs = await db.users.find().sort("created_at", 1).to_list(500)
    return [_to_model(doc) for doc in docs]


@router.post("", response_model=User, status_code=201)
async def create_user(payload: UserCreate):
    email = payload.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail.")

    user = User(
        name=payload.name.strip(),
        email=email,
        role=payload.role,
        is_active=payload.is_active,
    )
    await db.users.insert_one(
        {**user.model_dump(), "password_hash": hash_password(payload.password)}
    )
    return user


@router.put("/{user_id}", response_model=User)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    principal: Principal = Depends(require("users:manage")),
):
    doc = await db.users.find_one({"id": user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    changes: dict = {}
    if payload.name is not None:
        changes["name"] = payload.name.strip()
    if payload.role is not None:
        changes["role"] = payload.role
    if payload.is_active is not None:
        changes["is_active"] = payload.is_active

    # an admin must never lock themselves out, nor leave the shop without an admin
    losing_admin = doc["role"] == "ADMIN" and doc.get("is_active", False) and (
        changes.get("role", doc["role"]) != "ADMIN" or changes.get("is_active", True) is False
    )
    if losing_admin:
        if doc["id"] == principal.id:
            raise HTTPException(
                status_code=400, detail="Você não pode remover o seu próprio acesso de administrador."
            )
        if await _admin_count() <= 1:
            raise HTTPException(
                status_code=400, detail="É necessário manter pelo menos um administrador ativo."
            )

    if changes:
        await db.users.update_one({"id": user_id}, {"$set": changes})
        if changes.get("is_active") is False or changes.get("role"):
            await db.sessions.delete_many({"user_id": user_id})  # revoke now, not at expiry

    updated = await db.users.find_one({"id": user_id})
    return _to_model(updated)


@router.put("/{user_id}/password", status_code=204)
async def reset_password(user_id: str, payload: PasswordReset):
    doc = await db.users.find_one({"id": user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    await db.users.update_one(
        {"id": user_id}, {"$set": {"password_hash": hash_password(payload.password)}}
    )
    await db.sessions.delete_many({"user_id": user_id})
    return None


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str, principal: Principal = Depends(require("users:manage"))):
    doc = await db.users.find_one({"id": user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if doc["id"] == principal.id:
        raise HTTPException(status_code=400, detail="Você não pode excluir a sua própria conta.")
    if doc["role"] == "ADMIN" and await _admin_count() <= 1:
        raise HTTPException(
            status_code=400, detail="É necessário manter pelo menos um administrador ativo."
        )
    await db.users.delete_one({"id": user_id})
    await db.sessions.delete_many({"user_id": user_id})
    return None
