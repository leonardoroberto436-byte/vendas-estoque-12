"""Dashboard aggregates — mounted under /api/dashboard. Tenant-scoped.

"Today" and the 7/15/30-day window are anchored on the server in
America/Sao_Paulo, never on client-side date math.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query

from lib.auth import Principal, require_org, scoped
from lib.db import db
from models.inventory import (
    DashboardStats,
    LowStockItem,
    RevenuePoint,
    TopProduct,
    TopSeller,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

BR_TZ = ZoneInfo("America/Sao_Paulo")
ALLOWED_PERIODS = (7, 15, 30)


def _day_start(local_date) -> datetime:
    return datetime(local_date.year, local_date.month, local_date.day, tzinfo=BR_TZ).astimezone(
        timezone.utc
    )


def _aware(value) -> datetime:
    if isinstance(value, datetime) and value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value


@router.get("/stats", response_model=DashboardStats)
async def dashboard_stats(
    days: int = Query(default=7),
    principal: Principal = Depends(require_org),
):
    period = days if days in ALLOWED_PERIODS else 7

    now_local = datetime.now(timezone.utc).astimezone(BR_TZ)
    today_local = now_local.date()
    today_start = _day_start(today_local)
    window_start = _day_start(today_local - timedelta(days=period - 1))

    products = await db.products.find(scoped(principal)).to_list(5000)
    sales = await db.sales.find(scoped(principal, {"created_at": {"$gte": window_start}})).to_list(
        20000
    )
    returns = await db.returns.find(
        scoped(principal, {"created_at": {"$gte": window_start}})
    ).to_list(20000)

    today_sales = [s for s in sales if _aware(s["created_at"]) >= today_start]
    today_revenue = round(sum(float(s["total"]) for s in today_sales), 2)
    today_profit = round(sum(float(s.get("profit", 0)) for s in today_sales), 2)

    period_revenue = round(sum(float(s["total"]) for s in sales), 2)
    period_profit = round(sum(float(s.get("profit", 0)) for s in sales), 2)
    period_refunded = round(sum(float(r.get("refund_total", 0)) for r in returns), 2)

    low = [
        LowStockItem(
            id=p["id"],
            name=p["name"],
            sku=p["sku"],
            category=p["category"],
            current_stock=p["current_stock"],
            min_stock=p["min_stock"],
        )
        for p in products
        if p["current_stock"] <= p["min_stock"]
    ]
    low.sort(key=lambda i: (i.current_stock, i.name))

    inventory_value = round(
        sum(float(p["cost_price"]) * int(p["current_stock"]) for p in products), 2
    )

    buckets: dict[str, dict] = {}
    for offset in range(period - 1, -1, -1):
        key = (today_local - timedelta(days=offset)).isoformat()
        buckets[key] = {"revenue": 0.0, "sales_count": 0}
    for sale in sales:
        key = _aware(sale["created_at"]).astimezone(BR_TZ).date().isoformat()
        if key in buckets:
            buckets[key]["revenue"] += float(sale["total"])
            buckets[key]["sales_count"] += 1

    series = [
        RevenuePoint(date=key, revenue=round(value["revenue"], 2), sales_count=value["sales_count"])
        for key, value in buckets.items()
    ]

    tally: dict[str, dict] = {}
    sellers: dict[str, dict] = {}
    for sale in sales:
        for item in sale.get("items", []):
            entry = tally.setdefault(
                item["product_id"], {"name": item["product_name"], "quantity": 0, "revenue": 0.0}
            )
            entry["quantity"] += int(item["quantity"])
            entry["revenue"] += float(item["line_total"])

        seller_key = sale.get("seller_id") or sale.get("seller_name") or "—"
        seller = sellers.setdefault(
            seller_key,
            {
                "seller_id": sale.get("seller_id"),
                "name": sale.get("seller_name") or "Não informado",
                "sales_count": 0,
                "revenue": 0.0,
            },
        )
        seller["sales_count"] += 1
        seller["revenue"] += float(sale["total"])

    top = sorted(tally.items(), key=lambda kv: kv[1]["quantity"], reverse=True)[:5]
    top_products = [
        TopProduct(
            product_id=pid,
            name=data["name"],
            quantity=data["quantity"],
            revenue=round(data["revenue"], 2),
        )
        for pid, data in top
    ]
    top_sellers = [
        TopSeller(
            seller_id=data["seller_id"],
            name=data["name"],
            sales_count=data["sales_count"],
            revenue=round(data["revenue"], 2),
        )
        for data in sorted(sellers.values(), key=lambda d: -d["revenue"])[:5]
    ]

    return DashboardStats(
        today=today_local.isoformat(),
        today_sales_count=len(today_sales),
        today_revenue=today_revenue,
        today_profit=today_profit,
        low_stock_count=len(low),
        out_of_stock_count=sum(1 for p in products if p["current_stock"] == 0),
        inventory_value=inventory_value,
        product_count=len(products),
        period_days=period,
        period_revenue=period_revenue,
        period_profit=period_profit,
        period_sales_count=len(sales),
        period_returns_count=len(returns),
        period_refunded=period_refunded,
        period_net_revenue=round(period_revenue - period_refunded, 2),
        period_average_ticket=round(period_revenue / len(sales), 2) if sales else 0.0,
        low_stock_items=low[:20],
        revenue_series=series,
        top_products=top_products,
        top_sellers=top_sellers,
    )
