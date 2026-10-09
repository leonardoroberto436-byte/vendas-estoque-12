"""Products CRUD — mounted under /api/products."""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from lib.db import db
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
):
    query: dict = {}
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"sku": {"$regex": search, "$options": "i"}},
        ]
    if category and category != "TODAS":
        query["category"] = category
    docs = await db.products.find(query).sort("name", 1).to_list(1000)
    return [Product(**aware(doc)) for doc in docs]


@router.get("/categories", response_model=List[str])
async def list_categories():
    values = await db.products.distinct("category")
    return sorted(v for v in values if v)


@router.get("/{product_id}", response_model=Product)
async def get_product(product_id: str):
    doc = await db.products.find_one({"id": product_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return Product(**aware(doc))


@router.post("", response_model=Product, status_code=201)
async def create_product(payload: ProductCreate):
    existing = await db.products.find_one({"sku": payload.sku.strip().upper()})
    if existing:
        raise HTTPException(status_code=409, detail="SKU já cadastrado")
    product = Product(**{**payload.model_dump(), "sku": payload.sku.strip().upper()})
    await db.products.insert_one(product.model_dump())

    if product.current_stock > 0:
        movement = StockMovement(
            product_id=product.id,
            product_name=product.name,
            sku=product.sku,
            type="ENTRADA",
            quantity=product.current_stock,
            delta=product.current_stock,
            stock_after=product.current_stock,
            reason="Estoque inicial do cadastro",
        )
        await db.stock_movements.insert_one(movement.model_dump())
    return product


@router.put("/{product_id}", response_model=Product)
async def update_product(product_id: str, payload: ProductUpdate):
    doc = await db.products.find_one({"id": product_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    changes = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if "sku" in changes:
        changes["sku"] = changes["sku"].strip().upper()
        clash = await db.products.find_one({"sku": changes["sku"], "id": {"$ne": product_id}})
        if clash:
            raise HTTPException(status_code=409, detail="SKU já cadastrado em outro produto")
    changes["updated_at"] = datetime.now(timezone.utc)
    await db.products.update_one({"id": product_id}, {"$set": changes})
    updated = await db.products.find_one({"id": product_id})
    return Product(**aware(updated))


@router.delete("/{product_id}", status_code=204)
async def delete_product(product_id: str):
    result = await db.products.delete_one({"id": product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return None
