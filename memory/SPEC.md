# Estoque & Vendas Pro — SPEC

App de gerenciamento de vendas e estoque (pt-BR). **Acesso restrito por login** — só o admin libera contas.

## Papéis (RBAC, uma única loja — sem multi-tenant)
| Papel | Pode |
|---|---|
| `ADMIN` | Tudo + painel de usuários (`/admin`, `users:manage`) |
| `OPERADOR` | Tudo do app (vendas, estoque, produtos, relatórios) — **exceto** gerenciar usuários |

Sessão = cookie httpOnly `ev_session` (14 dias, coleção `sessions` com índice TTL). O principal é relido do banco a cada request: desativar/trocar perfil derruba a sessão na hora. Admin inicial vem de `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `backend/.env` via `ensure_bootstrap_admin()`. Senhas em PBKDF2-SHA256 (240k rounds). Credenciais em `memory/test_credentials.md`.

## Stack
FastAPI + MongoDB (motor) · Vite + React 19 + Tailwind v4 + shadcn/ui · TanStack Query · recharts.

## Rotas de UI
| Rota | Tela |
|---|---|
| `/login` | Login (pública) |
| `/` | Visão Geral — KPIs, gráfico de faturamento 7 dias, top produtos, alertas |
| `/vender` | Venda Balcão (POS) — carrinho, desconto, pagamento, finalizar |
| `/vendas` | Histórico de Vendas + modal de detalhe |
| `/produtos` | Catálogo CRUD (criar/editar/excluir, margem calculada) |
| `/estoque` | Movimentações + entrada e ajuste manual |
| `/alertas` | Produtos no/abaixo do estoque mínimo + botão Repor |
| `/relatorio` | Relatório Mensal — fechamento com faturamento, lucro, top produtos, formas de pagamento, botões **Imprimir** e **Excel** |
| `/perfil` | Meu Perfil — dados da conta + troca da própria senha (qualquer usuário logado) |
| `/admin` | Painel Administrativo (**só ADMIN**) — criar/ativar/desativar/excluir usuários, trocar perfil, redefinir senha |

## API (todas sob `/api`)
Todas as rotas abaixo exigem sessão válida (401 sem cookie), exceto `/api/auth/login`.
- `POST /api/auth/login` (pública) · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/change-password`
- `GET/POST /api/users` · `PUT /api/users/{id}` · `PUT /api/users/{id}/password` · `DELETE /api/users/{id}` — **ADMIN only (403 para operador)**
- `GET /api/reports/months` · `GET /api/reports/monthly?year=&month=` · `GET /api/reports/monthly.xlsx?year=&month=` (download de 4 abas: Resumo, Produtos, Pagamentos, Por dia — gerado com openpyxl)
- `GET /api/products?search=&category=` · `GET /api/products/categories` · `GET /api/products/{id}`
- `POST /api/products` (201, 409 em SKU duplicado) · `PUT /api/products/{id}` · `DELETE /api/products/{id}` (204)
- `GET /api/sales` · `GET /api/sales/{id}` · `POST /api/sales` (201; 400 se estoque insuficiente)
- `GET /api/stock/movements?product_id=` · `POST /api/stock/movements` (201; 400 se saída > estoque)
- `GET /api/dashboard/stats`

## Modelo de dados (coleções)
- **products**: id, name, sku (único, maiúsculo), category, cost_price, sale_price, current_stock, min_stock, created_at, updated_at
- **sales**: id, items[{product_id, product_name, sku, quantity, unit_price, unit_cost, line_total}], subtotal, discount, total, cost_total, profit, payment_method (DINHEIRO|PIX|CARTAO_DEBITO|CARTAO_CREDITO), notes, created_at
- **stock_movements**: id, product_id, product_name, sku, type (ENTRADA|VENDA|AJUSTE_POSITIVO|AJUSTE_NEGATIVO|PERDA), quantity, delta, stock_after, reason, sale_id, created_at
- **users**: id, name, email (único), role (ADMIN|OPERADOR), is_active, password_hash, created_at, last_login_at
- **sessions**: id, token (único), user_id, created_at, expires_at (índice TTL)

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
Login obrigatório em `/login`. Sem cadastro público — o admin cria e libera as contas em `/admin`.
Regras de segurança: um admin não pode se auto-rebaixar/excluir, e o sistema sempre mantém ao menos um admin ativo.
