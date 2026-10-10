"""Stock movements — mounted under /api/stock. Tenant-scoped."""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.auth import Principal, require, require_org, scoped
from lib.db import db
from models.inventory import StockMovement, StockMovementCreate

router = APIRouter(prefix="/stock", tags=["stock"])

POSITIVE_TYPES = {"ENTRADA", "DEVOLUCAO", "AJUSTE_POSITIVO"}


def aware(doc: dict) -> dict:
    value = doc.get("created_at")
    if isinstance(value, datetime) and value.tzinfo is None:
        doc["created_at"] = value.replace(tzinfo=timezone.utc)
    return doc


@router.get("/movements", response_model=List[StockMovement])
async def list_movements(
    product_id: Optional[str] = Query(default=None),
    limit: int = 200,
    principal: Principal = Depends(require_org),
):
    extra = {"product_id": product_id} if product_id else None
    docs = (
        await db.stock_movements.find(scoped(principal, extra))
        .sort("created_at", -1)
        .to_list(limit)
    )
    return [StockMovement(**aware(doc)) for doc in docs]


@router.post("/movements", response_model=StockMovement, status_code=201)
async def create_movement(
    payload: StockMovementCreate,
    principal: Principal = Depends(require("stock:write")),
):
    product = await db.products.find_one(scoped(principal, {"id": payload.product_id}))
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    delta = payload.quantity if payload.type in POSITIVE_TYPES else -payload.quantity
    if delta < 0 and product["current_stock"] + delta < 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Estoque insuficiente para {product['name']}: "
                f"disponível {product['current_stock']}"
            ),
        )

    guard: dict = {"id": payload.product_id}
    if delta < 0:
        # concurrency guard: a sale landing at the same moment cannot push stock below zero
        guard["current_stock"] = {"$gte": -delta}
    updated = await db.products.find_one_and_update(
        scoped(principal, guard),
        {"$inc": {"current_stock": delta}, "$set": {"updated_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    if not updated:
        raise HTTPException(
            status_code=409,
            detail=f"O estoque de {product['name']} mudou agora há pouco. Atualize e tente de novo.",
        )

    movement = StockMovement(
        org_id=principal.org_id,
        product_id=product["id"],
        product_name=product["name"],
        sku=product["sku"],
        type=payload.type,
        quantity=payload.quantity,
        delta=delta,
        stock_after=updated["current_stock"],
        reason=payload.reason,
        operator_name=principal.name,
    )
    await db.stock_movements.insert_one(movement.model_dump())
    return movement
