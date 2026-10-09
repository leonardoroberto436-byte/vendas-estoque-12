# Estoque & Vendas Pro — SPEC

**SaaS multiempresa (multi-tenant)** de gestão de vendas e estoque (pt-BR).

## Arquitetura de isolamento
- Coleção `organizations` = uma empresa cliente = um workspace isolado.
- Todo documento de negócio carrega `org_id` (`products`, `sales`, `returns`, `stock_movements`, `users`, `access_logs`).
- O `org_id` vem SEMPRE do principal da sessão (`lib/auth.py`), nunca do corpo/URL. `scoped(principal, extra)` monta o filtro Mongo já fixado na empresa — inclusive em buscas por id, o que neutraliza IDOR (id de outra empresa = 404).
- `require_org` protege rotas de loja; `require("platform:manage")` protege `/api/platform/*`.
- SKU é único **por empresa** (índice composto `org_id+sku`), não global.
- Cadastro público cria a empresa como `PENDENTE`; ela só funciona após o dono da plataforma aprovar.
- Suspender empresa, cancelar assinatura ou bloquear usuário apaga as sessões na hora (principal relido do banco a cada request).

## Papéis
| Papel | Pode |
|---|---|
| `PLATFORM_OWNER` | Só `/plataforma`: ver/aprovar/suspender empresas, trocar plano e status de assinatura. **Não** acessa dados de loja (403). |
| `ADMIN` | Tudo da sua empresa + `/admin` (usuários da própria empresa). |
| `OPERADOR` | Tudo da loja, exceto gerenciar usuários. |

## Assinaturas (estrutura pronta, **sem cobrança real**)
Planos: `TESTE` (14 dias, R$ 0) · `INICIAL` (R$ 49,90) · `PROFISSIONAL` (R$ 79,90) · `AVANCADO` (R$ 129,90). Preços editáveis pelo dono em `/plataforma` (coleção `platform_settings`, doc `plans`). Status: `TESTE`, `ATIVO`, `INADIMPLENTE` (avisa e mantém acesso), `CANCELADO` (bloqueia login). A integração com provedor de pagamento será feita depois.

**Receita**: `GET /api/platform/revenue` → `mrr` (só ATIVO), `overdue_amount` (INADIMPLENTE), `expected_mrr`, e quebra por plano. Só conta empresas APROVADAS.

**Vencimento + avisos**: `organizations.due_date` (definido manualmente pelo dono, gravado às 12:00 UTC para não virar o dia em America/Sao_Paulo). O cron `.emergent/crons.yml` → `POST /api/cron/subscription-reminders` (Bearer `WEBHOOK_CRON_SECRET`, acka na hora e processa em background) roda 12:00 BRT todo dia e envia e-mail 7/3/1 dia antes e no dia, deduplicado por `reminders_sent: ["YYYY-MM-DD:dias"]`. Trocar a data zera o ciclo. Trigger manual: `POST /api/platform/run-due-reminders`.

## Marca da empresa (cupom e relatório)
`organizations.branding` = `{trade_name, cnpj, phone, address, logo}` (logo = data URL PNG/JPG, máx. 300 KB). `GET /api/settings/branding` (qualquer membro — o PDV precisa) · `PUT /api/settings/branding` (**só ADMIN**). Editado em `/empresa`, aplicado no cupom do PDV (tela, impressão 80mm e texto do WhatsApp) e no cabeçalho de impressão do relatório mensal.

## Migração executada
`backend/migrate_tenancy.py` (dry-run por padrão, `--apply` executa): faz backup completo em `/app/backups/<timestamp>` (mongodump), cria/reutiliza a empresa dos dados legados ("Minha Loja", APROVADA/Profissional/ATIVO), preenche `org_id` retroativamente, remove o índice global de SKU e aplica o novo conjunto. Resultado da execução: 17 produtos, 17 vendas, 48 movimentações, 7 logs e 1 usuário migrados, **zero órfãos**.

## Testes
`backend/tests/test_tenant_isolation.py` — **50 testes, todos passando**: duas empresas fictícias, tentativas reais de ler/alterar/excluir dados da outra (produtos, vendas, estoque, devoluções, relatórios, usuários), injeção de `org_id` no payload, cookie forjado, operador tentando se promover, admin tentando criar PLATFORM_OWNER, suspensão/cancelamento derrubando sessão, e preservação dos dados legados.
Rodar: `cd /app/backend && set -a && . ./.env && set +a && python -m pytest tests/test_tenant_isolation.py -q`

Sessão = cookie httpOnly `ev_session` (14 dias). Senhas em PBKDF2-SHA256 (240k rounds). Tokens de reset guardados com hash SHA-256, uso único, 30 min. Credenciais em `memory/test_credentials.md`.

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
| `/cadastro` | Cadastro público de empresa (pública) |
| `/esqueci-senha` · `/redefinir-senha` | Recuperação de senha por e-mail (pública) |
| `/devolucoes` | Painel de Devoluções — estorno por item, repõe estoque, ajusta faturamento líquido |
| `/empresa` | Minha Empresa (**só ADMIN**) — logo + nome fantasia, CNPJ, telefone e endereço do cupom/relatório |
| `/plataforma` | Painel da Plataforma (**só PLATFORM_OWNER**) — KPIs, **Nova Empresa** (cria empresa + admin e mostra a senha gerada), editar dados, redefinir acesso do admin, liberar/suspender/reativar, plano e assinatura |
| `/` | Visão Geral — KPIs do dia, seletor de **7/15/30 dias** (faturamento, devoluções, líquido, ticket médio), gráficos, **vendas por vendedor**, alertas |
| `/vender` | Venda Balcão — carrinho, desconto, pagamento, finalizar; **cupom com vendedor e data, botão Imprimir (80mm) e Enviar no WhatsApp** |
| `/vendas` | Histórico de Vendas + modal de detalhe |
| `/produtos` | Catálogo CRUD (criar/editar/excluir, margem calculada) |
| `/estoque` | Movimentações + entrada e ajuste manual |
| `/alertas` | Produtos no/abaixo do estoque mínimo + botão Repor |
| `/relatorio` | Relatório Mensal — fechamento com faturamento, lucro, top produtos, formas de pagamento, botões **Imprimir** e **Excel** |
| `/perfil` | Meu Perfil — dados da conta + troca da própria senha (qualquer usuário logado) |
| `/admin` | Painel Administrativo (**só ADMIN**) — criar/ativar/desativar/excluir usuários, trocar perfil, redefinir senha |

## API (todas sob `/api`)
Todas as rotas abaixo exigem sessão válida (401 sem cookie), exceto `/api/auth/login`.
- `POST /api/auth/signup` (pública) · `POST /api/auth/login` (pública) · `POST /api/auth/forgot-password` (pública) · `POST /api/auth/reset-password` (pública)
- `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/change-password`
- `GET /api/platform/stats|organizations|users` · `POST /api/platform/organizations` (cria empresa APROVADA + usuário ADMIN, devolve a senha gerada uma única vez) · `PUT /api/platform/organizations/{id}` (nome/responsável/e-mail — o login do admin acompanha o e-mail) · `PUT /api/platform/organizations/{id}/status|plan` · `POST /api/platform/organizations/{id}/admin-password` (gera nova senha e derruba as sessões do admin) · `GET /api/platform/revenue` · `GET|PUT /api/platform/plan-prices` · `POST /api/platform/run-due-reminders` — **PLATFORM_OWNER only**
- `GET /api/settings/branding` (membro da empresa) · `PUT /api/settings/branding` (**ADMIN**)
- `POST /api/cron/subscription-reminders` — webhook do cron, auth por `Authorization: Bearer $WEBHOOK_CRON_SECRET` (401 sem/errado)
- `GET /api/returns` · `GET /api/returns/returnable` · `POST /api/returns`
- `GET /api/dashboard/stats?days=7|15|30`
- `GET/POST /api/users` · `PUT /api/users/{id}` · `PUT /api/users/{id}/password` · `DELETE /api/users/{id}` · `GET /api/users/access-logs` — **ADMIN only (403 para operador)**
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
- **access_logs**: id, user_id, user_name, email, role, event (LOGIN_OK|LOGIN_FALHOU|LOGIN_BLOQUEADO|LOGOUT), ip, user_agent, created_at — append-only, exibido em `/admin`

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
