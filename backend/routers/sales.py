"""Sales (venda balcão) — mounted under /api/sales. Tenant-scoped.

Finalising a sale decrements stock with a guarded, org-scoped update per item
(the `current_stock >= quantity` filter is the concurrency guard) and rolls back
anything already decremented if a later item cannot be served. The seller is
taken from the session principal, never from the request body.
"""

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import Principal, require, require_org, scoped
from lib.db import db
from models.inventory import Sale, SaleCreate, SaleItem, StockMovement

router = APIRouter(prefix="/sales", tags=["sales"])


def _sale_code(created: datetime) -> str:
    """Short human-readable receipt number, e.g. V-20261009-153847."""
    return f"V-{created.astimezone(timezone.utc).strftime('%Y%m%d-%H%M%S')}"


def aware(doc: dict) -> dict:
    value = doc.get("created_at")
    if isinstance(value, datetime) and value.tzinfo is None:
        doc["created_at"] = value.replace(tzinfo=timezone.utc)
    return doc


@router.get("", response_model=List[Sale])
async def list_sales(limit: int = 200, principal: Principal = Depends(require_org)):
    docs = await db.sales.find(scoped(principal)).sort("created_at", -1).to_list(limit)
    return [Sale(**aware(doc)) for doc in docs]


@router.get("/{sale_id}", response_model=Sale)
async def get_sale(sale_id: str, principal: Principal = Depends(require_org)):
    doc = await db.sales.find_one(scoped(principal, {"id": sale_id}))
    if not doc:
        raise HTTPException(status_code=404, detail="Venda não encontrada")
    return Sale(**aware(doc))


@router.post("", response_model=Sale, status_code=201)
async def create_sale(
    payload: SaleCreate, principal: Principal = Depends(require("sales:create"))
):
    # merge duplicate lines for the same product
    wanted: dict[str, int] = {}
    for item in payload.items:
        wanted[item.product_id] = wanted.get(item.product_id, 0) + item.quantity

    products = await db.products.find(scoped(principal, {"id": {"$in": list(wanted)}})).to_list(500)
    by_id = {p["id"]: p for p in products}

    # a product id from another company resolves to nothing here
    missing = [pid for pid in wanted if pid not in by_id]
    if missing:
        raise HTTPException(status_code=404, detail="Produto do carrinho não encontrado")

    for pid, qty in wanted.items():
        product = by_id[pid]
        if product["current_stock"] < qty:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Estoque insuficiente para {product['name']}: "
                    f"disponível {product['current_stock']}, solicitado {qty}"
                ),
            )

    applied: list[tuple[str, int]] = []
    sale_items: List[SaleItem] = []
    stock_after: dict[str, int] = {}
    try:
        for pid, qty in wanted.items():
            updated = await db.products.find_one_and_update(
                scoped(principal, {"id": pid, "current_stock": {"$gte": qty}}),
                {
                    "$inc": {"current_stock": -qty},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
                return_document=True,
            )
            if not updated:
                raise HTTPException(
                    status_code=400,
                    detail=f"Estoque insuficiente para {by_id[pid]['name']}",
                )
            applied.append((pid, qty))
            stock_after[pid] = updated["current_stock"]
            product = by_id[pid]
            sale_items.append(
                SaleItem(
                    product_id=pid,
                    product_name=product["name"],
                    sku=product["sku"],
                    quantity=qty,
                    unit_price=float(product["sale_price"]),
                    unit_cost=float(product["cost_price"]),
                    line_total=round(float(product["sale_price"]) * qty, 2),
                )
            )
    except Exception:
        for pid, qty in applied:  # give the stock back
            await db.products.update_one(
                scoped(principal, {"id": pid}), {"$inc": {"current_stock": qty}}
            )
        raise

    subtotal = round(sum(i.line_total for i in sale_items), 2)
    discount = round(min(payload.discount, subtotal), 2)
    total = round(subtotal - discount, 2)
    cost_total = round(sum(i.unit_cost * i.quantity for i in sale_items), 2)
    created = datetime.now(timezone.utc)

    sale = Sale(
        org_id=principal.org_id,
        code=_sale_code(created),
        items=sale_items,
        subtotal=subtotal,
        discount=discount,
        total=total,
        cost_total=cost_total,
        profit=round(total - cost_total, 2),
        payment_method=payload.payment_method,
        notes=payload.notes,
        seller_id=principal.id,
        seller_name=principal.name,
        created_at=created,
    )
    await db.sales.insert_one(sale.model_dump())

    movements = [
        StockMovement(
            org_id=principal.org_id,
            product_id=item.product_id,
            product_name=item.product_name,
            sku=item.sku,
            type="VENDA",
            quantity=item.quantity,
            delta=-item.quantity,
            stock_after=stock_after[item.product_id],
            reason=f"Baixa automática por venda {sale.code}",
            operator_name=principal.name,
            sale_id=sale.id,
            created_at=sale.created_at,
        ).model_dump()
        for item in sale_items
    ]
    await db.stock_movements.insert_many(movements)
    return sale
