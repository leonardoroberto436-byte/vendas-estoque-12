# Estoque & Vendas Pro — SPEC

App de gerenciamento de vendas e estoque (pt-BR), uso single-user, **sem login**.

## Stack
FastAPI + MongoDB (motor) · Vite + React 19 + Tailwind v4 + shadcn/ui · TanStack Query · recharts.

## Rotas de UI
| Rota | Tela |
|---|---|
| `/` | Visão Geral — KPIs, gráfico de faturamento 7 dias, top produtos, alertas |
| `/vender` | Venda Balcão (POS) — carrinho, desconto, pagamento, finalizar |
| `/vendas` | Histórico de Vendas + modal de detalhe |
| `/produtos` | Catálogo CRUD (criar/editar/excluir, margem calculada) |
| `/estoque` | Movimentações + entrada e ajuste manual |
| `/alertas` | Produtos no/abaixo do estoque mínimo + botão Repor |

## API (todas sob `/api`)
- `GET /api/products?search=&category=` · `GET /api/products/categories` · `GET /api/products/{id}`
- `POST /api/products` (201, 409 em SKU duplicado) · `PUT /api/products/{id}` · `DELETE /api/products/{id}` (204)
- `GET /api/sales` · `GET /api/sales/{id}` · `POST /api/sales` (201; 400 se estoque insuficiente)
- `GET /api/stock/movements?product_id=` · `POST /api/stock/movements` (201; 400 se saída > estoque)
- `GET /api/dashboard/stats`

## Modelo de dados (coleções)
- **products**: id, name, sku (único, maiúsculo), category, cost_price, sale_price, current_stock, min_stock, created_at, updated_at
- **sales**: id, items[{product_id, product_name, sku, quantity, unit_price, unit_cost, line_total}], subtotal, discount, total, cost_total, profit, payment_method (DINHEIRO|PIX|CARTAO_DEBITO|CARTAO_CREDITO), notes, created_at
- **stock_movements**: id, product_id, product_name, sku, type (ENTRADA|VENDA|AJUSTE_POSITIVO|AJUSTE_NEGATIVO|PERDA), quantity, delta, stock_after, reason, sale_id, created_at

## Regras de negócio
- Finalizar venda decrementa o estoque por item com guarda `current_stock >= quantity`; qualquer falha faz rollback do que já baixou.
- Cada item vendido gera um `stock_movements` tipo `VENDA` com `delta` negativo.
- Produto com `current_stock <= min_stock` entra nos alertas; `current_stock == 0` conta como esgotado.
- "Hoje" do dashboard é ancorado no servidor em `America/Sao_Paulo`.
- Estoque atual não é editável no formulário de produto — só por movimentação.

## Seed (`cd /app/backend && python seed.py`)
Recria tudo: 16 produtos brasileiros (Bebidas, Alimentos, Limpeza, Eletrônicos, Papelaria), ~13 vendas nos últimos 7 dias, 41 movimentações.
Produtos em alerta no seed: Cerveja Lata 350ml (8/24), Feijão Carioca 1kg (3/8), Sabão em Pó 1kg (0/6 — esgotado).

## Autenticação
Nenhuma — acesso direto, sem credenciais.
