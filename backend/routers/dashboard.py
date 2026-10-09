"""Dashboard aggregates — mounted under /api/dashboard."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter

from lib.db import db
from models.inventory import DashboardStats, LowStockItem, RevenuePoint, TopProduct

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

BR_TZ = ZoneInfo("America/Sao_Paulo")


def _day_start(local_date) -> datetime:
    return datetime(local_date.year, local_date.month, local_date.day, tzinfo=BR_TZ).astimezone(
        timezone.utc
    )


@router.get("/stats", response_model=DashboardStats)
async def dashboard_stats():
    now_local = datetime.now(timezone.utc).astimezone(BR_TZ)
    today_local = now_local.date()
    today_start = _day_start(today_local)
    window_start = _day_start(today_local - timedelta(days=6))

    products = await db.products.find().to_list(2000)
    sales = await db.sales.find({"created_at": {"$gte": window_start}}).to_list(5000)

    def created(doc) -> datetime:
        value = doc["created_at"]
        if isinstance(value, datetime) and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value

    today_sales = [s for s in sales if created(s) >= today_start]
    today_revenue = round(sum(float(s["total"]) for s in today_sales), 2)
    today_profit = round(sum(float(s.get("profit", 0)) for s in today_sales), 2)

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
    for offset in range(6, -1, -1):
        key = (today_local - timedelta(days=offset)).isoformat()
        buckets[key] = {"revenue": 0.0, "sales_count": 0}
    for sale in sales:
        key = created(sale).astimezone(BR_TZ).date().isoformat()
        if key in buckets:
            buckets[key]["revenue"] += float(sale["total"])
            buckets[key]["sales_count"] += 1

    series = [
        RevenuePoint(date=key, revenue=round(value["revenue"], 2), sales_count=value["sales_count"])
        for key, value in buckets.items()
    ]

    tally: dict[str, dict] = {}
    for sale in sales:
        for item in sale.get("items", []):
            entry = tally.setdefault(
                item["product_id"], {"name": item["product_name"], "quantity": 0, "revenue": 0.0}
            )
            entry["quantity"] += int(item["quantity"])
            entry["revenue"] += float(item["line_total"])
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

    return DashboardStats(
        today=today_local.isoformat(),
        today_sales_count=len(today_sales),
        today_revenue=today_revenue,
        today_profit=today_profit,
        low_stock_count=len(low),
        out_of_stock_count=sum(1 for p in products if p["current_stock"] == 0),
        inventory_value=inventory_value,
        product_count=len(products),
        low_stock_items=low[:20],
        revenue_series=series,
        top_products=top_products,
    )
