"""Returns / devoluções — mounted under /api/returns. Tenant-scoped.

A return is always tied to a sale of the SAME company. It can never exceed what
was sold minus what was already returned, and (optionally) puts the units back
in stock while logging a DEVOLUCAO movement.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.auth import Principal, require, require_org, scoped
from lib.db import db
from models.inventory import (
    ReturnableItem,
    ReturnableSale,
    ReturnCreate,
    ReturnItem,
    SaleReturn,
    StockMovement,
)

router = APIRouter(prefix="/returns", tags=["returns"])


def aware(doc: dict) -> dict:
    value = doc.get("created_at")
    if isinstance(value, datetime) and value.tzinfo is None:
        doc["created_at"] = value.replace(tzinfo=timezone.utc)
    return doc


def paid_ratio(sale: dict) -> float:
    """Fraction of the list price the customer actually paid on this sale.

    A sale of R$ 100 with R$ 20 of discount has ratio 0.8, so returning the whole
    sale refunds R$ 80 — never more than the customer paid.
    """
    subtotal = float(sale.get("subtotal") or 0)
    if subtotal <= 0:
        return 1.0
    total = float(sale.get("total", subtotal))
    return max(0.0, min(1.0, total / subtotal))


async def _returned_quantities(principal: Principal, sale_id: str) -> dict[str, int]:
    """How much of each product of this sale was already given back."""
    docs = await db.returns.find(scoped(principal, {"sale_id": sale_id})).to_list(500)
    tally: dict[str, int] = {}
    for doc in docs:
        for item in doc.get("items", []):
            tally[item["product_id"]] = tally.get(item["product_id"], 0) + int(item["quantity"])
    return tally


@router.get("", response_model=List[SaleReturn])
async def list_returns(
    sale_id: Optional[str] = Query(default=None),
    limit: int = 200,
    principal: Principal = Depends(require_org),
):
    extra = {"sale_id": sale_id} if sale_id else None
    docs = await db.returns.find(scoped(principal, extra)).sort("created_at", -1).to_list(limit)
    return [SaleReturn(**aware(doc)) for doc in docs]


@router.get("/returnable", response_model=List[ReturnableSale])
async def returnable_sales(limit: int = 50, principal: Principal = Depends(require_org)):
    """Recent sales that still have at least one unit eligible for return."""
    sales = await db.sales.find(scoped(principal)).sort("created_at", -1).to_list(limit)
    result: List[ReturnableSale] = []
    for sale in sales:
        tally = await _returned_quantities(principal, sale["id"])
        items = []
        for item in sale.get("items", []):
            already = tally.get(item["product_id"], 0)
            remaining = int(item["quantity"]) - already
            items.append(
                ReturnableItem(
                    product_id=item["product_id"],
                    product_name=item["product_name"],
                    sku=item["sku"],
                    sold_quantity=int(item["quantity"]),
                    returned_quantity=already,
                    returnable_quantity=max(0, remaining),
                    # what the customer actually paid per unit (discount applied)
                    unit_price=round(float(item["unit_price"]) * paid_ratio(sale), 2),
                )
            )
        if any(i.returnable_quantity > 0 for i in items):
            result.append(
                ReturnableSale(
                    sale_id=sale["id"],
                    sale_code=sale.get("code", ""),
                    created_at=aware(sale)["created_at"],
                    seller_name=sale.get("seller_name", ""),
                    total=float(sale["total"]),
                    already_refunded=float(sale.get("returned_total", 0)),
                    items=items,
                )
            )
    return result


@router.post("", response_model=SaleReturn, status_code=201)
async def create_return(
    payload: ReturnCreate, principal: Principal = Depends(require("returns:create"))
):
    # a sale id from another company resolves to nothing here
    sale = await db.sales.find_one(scoped(principal, {"id": payload.sale_id}))
    if not sale:
        raise HTTPException(status_code=404, detail="Venda não encontrada")

    sold = {i["product_id"]: i for i in sale.get("items", [])}
    already = await _returned_quantities(principal, sale["id"])
    ratio = paid_ratio(sale)

    wanted: dict[str, int] = {}
    for item in payload.items:
        wanted[item.product_id] = wanted.get(item.product_id, 0) + item.quantity

    return_items: List[ReturnItem] = []
    for pid, qty in wanted.items():
        line = sold.get(pid)
        if not line:
            raise HTTPException(status_code=400, detail="Produto não faz parte desta venda")
        remaining = int(line["quantity"]) - already.get(pid, 0)
        if qty > remaining:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Devolução maior que o vendido para {line['product_name']}: "
                    f"disponível para devolver {remaining}"
                ),
            )
        # refund what the customer paid, i.e. the list price minus the sale discount
        paid_unit = round(float(line["unit_price"]) * ratio, 2)
        return_items.append(
            ReturnItem(
                product_id=pid,
                product_name=line["product_name"],
                sku=line["sku"],
                quantity=qty,
                unit_price=paid_unit,
                unit_cost=float(line["unit_cost"]),
                line_total=round(paid_unit * qty, 2),
            )
        )

    # Reserve the quantities atomically on the sale itself, so two returns sent at
    # the same moment can never give back more units than were sold.
    await db.sales.update_one(
        scoped(principal, {"id": sale["id"], "returned_qty": {"$exists": False}}),
        {"$set": {"returned_qty": already}},
    )
    reserved: list[tuple[str, int]] = []
    try:
        for pid, qty in wanted.items():
            limit = int(sold[pid]["quantity"]) - qty
            result = await db.sales.update_one(
                scoped(
                    principal,
                    {"id": sale["id"], f"returned_qty.{pid}": {"$not": {"$gt": limit}}},
                ),
                {"$inc": {f"returned_qty.{pid}": qty}},
            )
            if result.modified_count != 1:
                raise HTTPException(
                    status_code=409,
                    detail="Outra devolução desta venda acabou de ser registrada. Atualize e tente de novo.",
                )
            reserved.append((pid, qty))
    except Exception:
        for pid, qty in reserved:  # undo the reservation
            await db.sales.update_one(
                scoped(principal, {"id": sale["id"]}), {"$inc": {f"returned_qty.{pid}": -qty}}
            )
        raise

    refund_total = round(sum(i.line_total for i in return_items), 2)
    # never refund more than what is left of the amount the customer paid
    still_refundable = round(float(sale.get("total", 0)) - float(sale.get("returned_total", 0)), 2)
    refund_total = max(0.0, min(refund_total, still_refundable))
    cost_total = round(sum(i.unit_cost * i.quantity for i in return_items), 2)
    created = datetime.now(timezone.utc)

    sale_return = SaleReturn(
        org_id=principal.org_id,
        sale_id=sale["id"],
        sale_code=sale.get("code", ""),
        items=return_items,
        refund_total=refund_total,
        cost_total=cost_total,
        reason=payload.reason,
        restocked=payload.restock,
        operator_id=principal.id,
        operator_name=principal.name,
        created_at=created,
    )
    await db.returns.insert_one(sale_return.model_dump())
    await db.sales.update_one(
        scoped(principal, {"id": sale["id"]}), {"$inc": {"returned_total": refund_total}}
    )

    if payload.restock:
        for item in return_items:
            updated = await db.products.find_one_and_update(
                scoped(principal, {"id": item.product_id}),
                {
                    "$inc": {"current_stock": item.quantity},
                    "$set": {"updated_at": created},
                },
                return_document=True,
            )
            await db.stock_movements.insert_one(
                StockMovement(
                    org_id=principal.org_id,
                    product_id=item.product_id,
                    product_name=item.product_name,
                    sku=item.sku,
                    type="DEVOLUCAO",
                    quantity=item.quantity,
                    delta=item.quantity,
                    stock_after=updated["current_stock"] if updated else item.quantity,
                    reason=f"Devolução da venda {sale.get('code', '')}".strip(),
                    operator_name=principal.name,
                    sale_id=sale["id"],
                    created_at=created,
                ).model_dump()
            )

    return sale_return
