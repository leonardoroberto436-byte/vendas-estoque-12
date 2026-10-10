"""Products CRUD — mounted under /api/products. Tenant-scoped.

Every query goes through `scoped(principal, ...)`, so a lookup by id is always
`{"id": ..., "org_id": <caller's org>}`. Knowing another company's product id is
therefore useless: the row simply does not exist for this caller (404).
"""

import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.auth import Principal, require, require_org, scoped
from lib.db import db
from lib.plans import ensure_can_add
from models.inventory import Product, ProductCreate, ProductUpdate, StockMovement

router = APIRouter(prefix="/products", tags=["products"])


def aware(doc: dict) -> dict:
    """Motor hands back naive datetimes — normalise to aware UTC before Pydantic."""
    for key in ("created_at", "updated_at"):
        value = doc.get(key)
        if isinstance(value, datetime) and value.tzinfo is None:
            doc[key] = value.replace(tzinfo=timezone.utc)
    return doc


@router.get("", response_model=List[Product])
async def list_products(
    search: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    principal: Principal = Depends(require_org),
):
    extra: dict = {}
    if search:
        # literal search: characters like "(" or "+" in a part code must match as
        # typed, and a crafted pattern must not be able to stall the database
        pattern = re.escape(search.strip()[:80])
        extra["$or"] = [
            {"name": {"$regex": pattern, "$options": "i"}},
            {"sku": {"$regex": pattern, "$options": "i"}},
        ]
    if category and category != "TODAS":
        extra["category"] = category
    docs = await db.products.find(scoped(principal, extra)).sort("name", 1).to_list(1000)
    return [Product(**aware(doc)) for doc in docs]


@router.get("/categories", response_model=List[str])
async def list_categories(principal: Principal = Depends(require_org)):
    values = await db.products.distinct("category", scoped(principal))
    return sorted(v for v in values if v)


@router.get("/{product_id}", response_model=Product)
async def get_product(product_id: str, principal: Principal = Depends(require_org)):
    doc = await db.products.find_one(scoped(principal, {"id": product_id}))
    if not doc:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return Product(**aware(doc))


@router.post("", response_model=Product, status_code=201)
async def create_product(
    payload: ProductCreate, principal: Principal = Depends(require("products:write"))
):
    await ensure_can_add(principal.org_id, "products", "produtos")
    sku = payload.sku.strip().upper()
    # SKU is unique per company, not globally — two companies may use the same code
    existing = await db.products.find_one(scoped(principal, {"sku": sku}))
    if existing:
        raise HTTPException(status_code=409, detail="SKU já cadastrado")

    product = Product(**{**payload.model_dump(), "sku": sku}, org_id=principal.org_id)
    await db.products.insert_one(product.model_dump())

    if product.current_stock > 0:
        movement = StockMovement(
            org_id=principal.org_id,
            product_id=product.id,
            product_name=product.name,
            sku=product.sku,
            type="ENTRADA",
            quantity=product.current_stock,
            delta=product.current_stock,
            stock_after=product.current_stock,
            reason="Estoque inicial do cadastro",
            operator_name=principal.name,
        )
        await db.stock_movements.insert_one(movement.model_dump())
    return product


@router.put("/{product_id}", response_model=Product)
async def update_product(
    product_id: str,
    payload: ProductUpdate,
    principal: Principal = Depends(require("products:write")),
):
    doc = await db.products.find_one(scoped(principal, {"id": product_id}))
    if not doc:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    changes = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if "sku" in changes:
        changes["sku"] = changes["sku"].strip().upper()
        clash = await db.products.find_one(
            scoped(principal, {"sku": changes["sku"], "id": {"$ne": product_id}})
        )
        if clash:
            raise HTTPException(status_code=409, detail="SKU já cadastrado em outro produto")
    changes["updated_at"] = datetime.now(timezone.utc)
    await db.products.update_one(scoped(principal, {"id": product_id}), {"$set": changes})
    updated = await db.products.find_one(scoped(principal, {"id": product_id}))
    return Product(**aware(updated))


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: str, principal: Principal = Depends(require("products:write"))
):
    result = await db.products.delete_one(scoped(principal, {"id": product_id}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return None
