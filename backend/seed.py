"""Idempotent seed: realistic Brazilian retail catalogue + recent sales history.

Run: cd /app/backend && python seed.py
"""

import asyncio
import random
from datetime import datetime, timedelta, timezone

from lib.db import db, ensure_indexes
from models.inventory import Product, Sale, SaleItem, StockMovement

CATALOGUE = [
    # name, sku, category, cost, price, stock, min_stock
    ("Refrigerante Cola 2L", "BEB-001", "Bebidas", 5.20, 9.90, 48, 12),
    ("Água Mineral 500ml", "BEB-002", "Bebidas", 0.95, 2.50, 120, 36),
    ("Cerveja Lata 350ml", "BEB-003", "Bebidas", 2.60, 4.99, 8, 24),
    ("Suco de Laranja 1L", "BEB-004", "Bebidas", 4.10, 8.49, 30, 10),
    ("Café Torrado 500g", "ALI-001", "Alimentos", 11.80, 19.90, 26, 8),
    ("Arroz Branco 5kg", "ALI-002", "Alimentos", 18.40, 27.90, 14, 6),
    ("Feijão Carioca 1kg", "ALI-003", "Alimentos", 6.70, 10.49, 3, 8),
    ("Açúcar Refinado 1kg", "ALI-004", "Alimentos", 3.40, 5.79, 40, 12),
    ("Óleo de Soja 900ml", "ALI-005", "Alimentos", 6.10, 9.49, 22, 10),
    ("Detergente Neutro 500ml", "LIM-001", "Limpeza", 1.90, 3.79, 60, 18),
    ("Sabão em Pó 1kg", "LIM-002", "Limpeza", 9.30, 15.90, 0, 6),
    ("Desinfetante 2L", "LIM-003", "Limpeza", 7.20, 12.90, 18, 6),
    ("Pilha Alcalina AA (4un)", "ELE-001", "Eletrônicos", 12.50, 22.90, 16, 5),
    ("Cabo USB-C 1m", "ELE-002", "Eletrônicos", 9.80, 24.90, 11, 4),
    ("Caderno Universitário 200f", "PAP-001", "Papelaria", 11.20, 21.90, 9, 5),
    ("Caneta Esferográfica Azul", "PAP-002", "Papelaria", 0.80, 2.49, 150, 40),
]

PAYMENTS = ["DINHEIRO", "PIX", "CARTAO_DEBITO", "CARTAO_CREDITO"]


async def main() -> None:
    random.seed(7)
    await db.products.drop()
    await db.sales.drop()
    await db.stock_movements.drop()
    await ensure_indexes()

    products: list[Product] = []
    movements: list[dict] = []
    base = datetime.now(timezone.utc) - timedelta(days=7)

    for name, sku, category, cost, price, stock, min_stock in CATALOGUE:
        product = Product(
            name=name,
            sku=sku,
            category=category,
            cost_price=cost,
            sale_price=price,
            current_stock=stock,
            min_stock=min_stock,
            created_at=base,
            updated_at=base,
        )
        products.append(product)
        movements.append(
            StockMovement(
                product_id=product.id,
                product_name=product.name,
                sku=product.sku,
                type="ENTRADA",
                quantity=stock + 20,
                delta=stock + 20,
                stock_after=stock + 20,
                reason="Carga inicial de estoque",
                created_at=base,
            ).model_dump()
        )

    await db.products.insert_many([p.model_dump() for p in products])

    # ~18 sales spread over the last 7 days (today included), stock already reflects them
    stock_by_id = {p.id: p.current_stock for p in products}
    sales: list[dict] = []
    for day_offset in range(6, -1, -1):
        for _ in range(random.randint(1, 4)):
            chosen = random.sample(products, random.randint(1, 3))
            items: list[SaleItem] = []
            for product in chosen:
                qty = random.randint(1, 3)
                items.append(
                    SaleItem(
                        product_id=product.id,
                        product_name=product.name,
                        sku=product.sku,
                        quantity=qty,
                        unit_price=product.sale_price,
                        unit_cost=product.cost_price,
                        line_total=round(product.sale_price * qty, 2),
                    )
                )
            subtotal = round(sum(i.line_total for i in items), 2)
            cost_total = round(sum(i.unit_cost * i.quantity for i in items), 2)
            created = datetime.now(timezone.utc) - timedelta(
                days=day_offset, hours=random.randint(0, 6), minutes=random.randint(0, 59)
            )
            sale = Sale(
                items=items,
                subtotal=subtotal,
                discount=0.0,
                total=subtotal,
                cost_total=cost_total,
                profit=round(subtotal - cost_total, 2),
                payment_method=random.choice(PAYMENTS),
                notes="",
                created_at=created,
            )
            sales.append(sale.model_dump())
            for item in items:
                movements.append(
                    StockMovement(
                        product_id=item.product_id,
                        product_name=item.product_name,
                        sku=item.sku,
                        type="VENDA",
                        quantity=item.quantity,
                        delta=-item.quantity,
                        stock_after=stock_by_id.get(item.product_id, 0),
                        reason="Baixa automática por venda",
                        sale_id=sale.id,
                        created_at=created,
                    ).model_dump()
                )

    await db.sales.insert_many(sales)
    await db.stock_movements.insert_many(movements)
    print(f"seed ok: {len(products)} produtos, {len(sales)} vendas, {len(movements)} movimentações")


if __name__ == "__main__":
    asyncio.run(main())
