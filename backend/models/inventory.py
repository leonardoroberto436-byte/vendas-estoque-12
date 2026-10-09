"""Pydantic v2 models for products, sales and stock movements.

Keep each model in sync with its hand-written TS interface in
frontend/src/lib/types.ts — nothing infers across the HTTP boundary.
"""

import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid() -> str:
    return str(uuid.uuid4())


MovementType = Literal["ENTRADA", "VENDA", "AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "PERDA"]
PaymentMethod = Literal["DINHEIRO", "PIX", "CARTAO_DEBITO", "CARTAO_CREDITO"]


# ---------------------------------------------------------------- products
class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sku: str = Field(min_length=1, max_length=40)
    category: str = Field(min_length=1, max_length=60)
    cost_price: float = Field(ge=0)
    sale_price: float = Field(ge=0)
    current_stock: int = Field(default=0, ge=0)
    min_stock: int = Field(default=0, ge=0)


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    sku: Optional[str] = Field(default=None, min_length=1, max_length=40)
    category: Optional[str] = Field(default=None, min_length=1, max_length=60)
    cost_price: Optional[float] = Field(default=None, ge=0)
    sale_price: Optional[float] = Field(default=None, ge=0)
    min_stock: Optional[int] = Field(default=None, ge=0)


class Product(BaseModel):
    id: str = Field(default_factory=_uid)
    name: str
    sku: str
    category: str
    cost_price: float
    sale_price: float
    current_stock: int
    min_stock: int
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


# ------------------------------------------------------------------- sales
class SaleItemInput(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)


class SaleCreate(BaseModel):
    items: List[SaleItemInput] = Field(min_length=1)
    payment_method: PaymentMethod = "DINHEIRO"
    discount: float = Field(default=0, ge=0)
    notes: str = ""


class SaleItem(BaseModel):
    product_id: str
    product_name: str
    sku: str
    quantity: int
    unit_price: float
    unit_cost: float
    line_total: float


class Sale(BaseModel):
    id: str = Field(default_factory=_uid)
    items: List[SaleItem]
    subtotal: float
    discount: float
    total: float
    cost_total: float
    profit: float
    payment_method: PaymentMethod
    notes: str = ""
    created_at: datetime = Field(default_factory=_now)


# --------------------------------------------------------- stock movements
class StockMovementCreate(BaseModel):
    product_id: str
    type: MovementType
    quantity: int = Field(gt=0)
    reason: str = ""


class StockMovement(BaseModel):
    id: str = Field(default_factory=_uid)
    product_id: str
    product_name: str
    sku: str
    type: MovementType
    quantity: int
    delta: int
    stock_after: int
    reason: str = ""
    sale_id: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)


# --------------------------------------------------------------- dashboard
class LowStockItem(BaseModel):
    id: str
    name: str
    sku: str
    category: str
    current_stock: int
    min_stock: int


class RevenuePoint(BaseModel):
    date: str
    revenue: float
    sales_count: int


class TopProduct(BaseModel):
    product_id: str
    name: str
    quantity: int
    revenue: float


class DashboardStats(BaseModel):
    today: str
    today_sales_count: int
    today_revenue: float
    today_profit: float
    low_stock_count: int
    out_of_stock_count: int
    inventory_value: float
    product_count: int
    low_stock_items: List[LowStockItem]
    revenue_series: List[RevenuePoint]
    top_products: List[TopProduct]
