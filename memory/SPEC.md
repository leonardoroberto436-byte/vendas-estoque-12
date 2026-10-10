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

## Permissões (deny-by-default, `lib/auth.py`)
- `PLATFORM_OWNER`: só `platform:manage` — 403 em qualquer rota de loja.
- `ADMIN` (empresa): `shop:read`, `shop:write`, `products:write`, `stock:write`, `sales:create`, `returns:create`, `reports:read`, `users:manage`.
- `OPERADOR` (vendedor): **só** `shop:read`, `sales:create`, `returns:create`, `reports:read` — não cria/edita/apaga produto, não ajusta estoque, não gerencia usuários nem a marca. Rotas de escrita usam `Depends(require("<permissão>"))`; a UI esconde os botões correspondentes (Produtos e Movimentações).

## Rodada de segurança 10/10/2026 (4 itens de alta severidade)
1. **Token de sessão em texto puro no banco** (`lib/auth.py:94` campo `token`, consultas em `:115`/`:154`/`:162`, índice `lib/db.py:58`) — um dump ou um backup baixado entregava sessões vivas. Agora só `sha256(token)` é gravado em `sessions.token_hash` (`lib/auth.py:96,117,156,164`; índice `lib/db.py:59`). Todas as sessões antigas foram apagadas.
2. **Credenciais reais fixas no repositório** — `tests/test_tenant_isolation.py`, 5 `tests/test_tscheck_*.py`, `memory/test_credentials.md` e `.emergent/scripts/checks/*.mjs`. Agora tudo lê do ambiente (`tests/credentials.py::env()`, `process.env.*`); a suíte faz *skip* se a variável não existir.
3. **`POST /api/auth/signup` sem limite** (`routers/auth.py:120`) — criação em massa de empresas falsas e queima da cota de e-mail. Limite `SIGNUP_LIMIT_PER_HOUR` (padrão 30/h por IP).
4. **`POST /api/auth/reset-password` sem limite** (`routers/auth.py:305`) — força bruta de token. Limite 10/15 min por IP.

Extras da mesma rodada:
- **Política de senha** (`lib/password_policy.py`): mínimo 10 caracteres, letras + números, não pode ser igual à atual e não pode estar em `BLOCKED_PASSWORDS` (senhas que vazaram). Aplicada em `/auth/change-password`, `/auth/reset-password` e `PUT /api/users/{id}/password`.
- **Toast global** (`main.tsx`): havia um `<Toaster>` por página; o toast disparado antes de navegar morria junto. Agora é um só, na raiz.
- **Defensivas no front** — `PointOfSale` (lista/categorias memoizadas), `MovementDialog` (`types[0]` com fallback), `MonthlyReport` (ano/mês com `Number.isFinite`), `Login` (nome ausente), `lib/format.ts` (acesso indexado seguro).
- **Conta de QA** `COMPANY_ADMIN_*` (ADMIN da "Minha Loja"): a suíte não usa mais a conta pessoal do dono.

## Endurecimento de segurança (auditoria 09/10/2026 — `/app/test_reports/security_audit.md`)
- `CORS_ORIGINS` com origem explícita (nunca `*` com credenciais).
- Cookie de sessão: `HttpOnly` + `Secure` + `SameSite=Lax` → **testes precisam usar HTTPS**.
- `lib/throttle.py`: 8 tentativas/5 min no login (por IP+conta, zeradas no acerto) e 5/15 min no esqueci-senha → 429.
- Rotas de exemplo `/api/status` removidas.
- Suítes: `backend/tests/test_tenant_isolation.py` (50 testes) e `backend/audit_dynamic.py` (66 testes dinâmicos, cria e apaga duas empresas fictícias).

## Backups automáticos e auditoria do proprietário (revisado em 10/10/2026)
- `lib/backups.py`: `run_backup()` lê o banco pelo **motor** (sem `mongodump`, funciona no Atlas de produção), grava `/app/backups/auto-<ts>.tar.gz` com um `<coleção>.jsonl` (Extended JSON) por coleção + `manifest.json`, e mantém os **7 mais recentes** (`BACKUP_KEEP`). **`sessions` e `password_resets` nunca entram no backup.** Compressão e upload rodam em `asyncio.to_thread` — não travam o servidor.
- **Cópia externa (opcional)**: se `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID` e `BACKUP_S3_SECRET_ACCESS_KEY` existirem (+ `BACKUP_S3_ENDPOINT` p/ R2/B2, `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX`), cada backup também sobe para o bucket via boto3. Campo `offsite` no registro: `ENVIADO` / `FALHOU` / `NAO_CONFIGURADO`. `GET /api/platform/backups/settings` → `{offsite_configured, keep}`; o painel mostra aviso amarelo quando não está ligado.
- **Restauração**: `lib/restore.py` (`read_archive` lê jsonl-v1 e também os .bson antigos do mongodump; `select_org`; `write` = upsert por `id`). Painel: `POST /api/platform/backups/{arquivo}/restore` `{org_id, confirm}` — `confirm=false` só mostra contagens; `confirm=true` faz backup de segurança antes e regrava os registros da empresa (não apaga o que foi criado depois). Linha de comando: `python restore_backup.py ARQ.tar.gz --org ID [--yes]` ou `--all`.
- Cron `.emergent/crons.yml` → `POST /api/cron/backup` (Bearer `WEBHOOK_CRON_SECRET`), **06:00 BRT diário**.
- Painel: `POST /api/platform/backups/run`, `GET /api/platform/backups`, `GET /api/platform/backups/{arquivo}/download` (nome saneado — traversal → 404).
- **Exportação pela loja**: `GET /api/settings/export.xlsx` (só ADMIN, só a própria empresa) — produtos, vendas, itens, devoluções, movimentações. Botão em `/empresa`.
- Trilha de auditoria: `log_platform_action()` → `platform_logs`: `EMPRESA_CRIADA`, `EMPRESA_EDITADA`, `EMPRESA_EXCLUIDA`, `EMPRESA_RESTAURADA`, `USUARIO_EXCLUIDO`, `SENHA_ADMIN_REDEFINIDA`, `STATUS_<novo>`, `PLANO_ALTERADO`, `PRECOS_ALTERADOS`, `BACKUP_MANUAL`, `INADIMPLENTE_AUTOMATICO` (ator `sistema`). Todas as rotas são **PLATFORM_OWNER only**.

## Remoção de contas pelo dono (10/10/2026)
- `DELETE /api/platform/organizations/{id}` body `{confirm_name}` (nome exato) e `POST /api/platform/organizations/bulk-delete` `{ids, confirm:"EXCLUIR"}`: backup de segurança primeiro (se falhar, nada é apagado), depois apaga empresa + users + sessions + password_resets + products + sales + returns + stock_movements + access_logs.
- `DELETE /api/platform/users/{id}`: nunca o PLATFORM_OWNER; recusa o último ADMIN ativo da empresa (aí exclui-se a empresa).
- UI `/plataforma`: checkbox por linha, "Selecionar sem uso" (0 vendas, 0 produtos, assinatura ≠ ATIVO), "Excluir selecionadas", lixeira por empresa e por usuário.

## Assinatura automática (10/10/2026)
- `lib/auth.trial_expired(org)`: `subscription_status == TESTE` e `trial_ends_at` no passado → login e toda requisição da empresa dão **403** com `TRIAL_OVER_MESSAGE`. O dono libera mudando para plano pago + `ATIVO`, ou prorroga: com assinatura `TESTE`, a data salva em "Vencimento" (`PUT /plan` `due_date`) vira o novo `trial_ends_at` (23:59 UTC). `trial_expired` aparece em `OrgSummary`/`PlatformOrgView`.
- `lib/subscriptions.mark_overdue()` (roda no cron diário de avisos): `ATIVO` com vencimento passado → `INADIMPLENTE` (não suspende — o dono decide).

## Outras regras revisadas (10/10/2026)
- **Devolução**: reembolso = preço unitário × (total/subtotal da venda) — respeita o desconto e nunca passa do valor pago. Reserva atômica em `sales.returned_qty.<product_id>` impede duas devoluções simultâneas de passar do vendido (409).
- **Relatório mensal**: novos campos `refunds_total`, `refunds_count`, `net_revenue`, `net_profit`; margem calculada sobre o líquido; KPIs da tela e o Excel mostram bruto, devoluções e líquido.
- **Ajuste manual de estoque**: baixa com guarda `current_stock >= quantidade` (409 se mudou).
- **Alertas de estoque**: `organizations.alerts.low_stock_enabled` (padrão true). `GET/PUT /api/settings/alerts` (PUT só ADMIN). Desligado → dashboard devolve `low_stock_count=0`/lista vazia e a tela `/alertas` mostra o aviso.
- **IP do cliente** (`lib/throttle.client_ip`): usa a entrada do `X-Forwarded-For` adicionada pelo proxy confiável (`TRUSTED_PROXY_HOPS`, padrão 1 = última), não a primeira (que o cliente forja). Vale para o limite de tentativas e para o log de acesso.
- Busca de produtos usa `re.escape` (sem regex do usuário). Cadastro, criação de usuário e trocas de senha passam por `validate_new_password` (mín. 10, letras + números).

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

## Cobrança Mercado Pago, limites por plano e termos (10/10/2026 — tarde)
- **Teste grátis: 2 dias** (`models/org.TRIAL_DAYS`). Preços padrão R$ 79 / 129 / 199 (o dono altera no painel; valores já salvos no banco prevalecem).
- **Limites** (`lib/plans.py`, padrão em `models/org.DEFAULT_PLAN_LIMITS`, editáveis em `GET/PUT /api/platform/plan-limits`; exceção por loja `PUT /api/platform/organizations/{id}/limits` → `organizations.limit_overrides`). Conferidos no back-end: criar usuário/produto (403 "faça upgrade"), logo só com `branding` (logo antigo fica guardado e oculto), relatório básico (`MonthlyReport.basic`: custo/lucro/margem/ranking zerados) e janela de histórico (`history_months`, 403 fora dela). Teste grátis usa a linha TESTE (= Profissional).
- **Bloqueio por cobrança** (`lib/billing.billing_block`): `TESTE_ENCERRADO`, `PAGAMENTO` (status SUSPENSA + `suspended_reason=PAGAMENTO`), `CANCELADO`. ADMIN loga e só usa `/api/billing*` (`require_billing_admin`); `require_org`/`require` devolvem 403 com header `X-Billing-Block`; vendedores recebem 403 no login. `OrgSummary.billing_block` → front redireciona para `/assinatura`. Suspensão manual do dono = `suspended_reason=MANUAL` (bloqueio total como antes).
- **Mercado Pago** (`lib/mercadopago.py`, `routers/billing.py`): `POST /api/billing/subscribe {plan, coupon, payer_email?}` cria preapproval `status=pending` e devolve `init_point`; `POST /api/billing/change-plan` (maior = na hora; menor = `billing.plan_next` na próxima cobrança; PUT no preapproval com valor novo); `POST /api/billing/cancel` (preapproval cancelled, `billing.cancel_at`=vencimento). Webhook `POST /api/billing/webhook` valida `x-signature` (HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com `MP_WEBHOOK_SECRET`), busca o recurso na API (`/preapproval/{id}`, `/authorized_payments/{id}`) e aplica: authorized/approved → ATIVO (+reativa suspensão por pagamento), rejected/recycling/paused → INADIMPLENTE + `billing.payment_failed_at` + e-mail; cancelled → acesso até o fim do período. Pagamentos aprovados em `billing_payments` (MRR recebido 30d no painel). Eventos em `billing_events`.
- Rotina diária (`run_billing_daily`, no mesmo cron dos avisos): suspende após `PAYMENT_GRACE_DAYS` (padrão 5), avisa 1 dia antes, fecha cancelamentos vencidos e avisa fim do teste. Empresas com cartão autorizado não recebem os avisos de vencimento manuais nem o "inadimplente automático".
- Cupom `FUNDADOR`: 50% vitalício, 10 primeiras empresas (`billing.coupon`).
- **Termos**: `POST /api/auth/signup` exige `accept_terms=true` e grava `terms_accepted_at/terms_version/terms_accepted_ip` na empresa e no usuário. `GET /api/legal` (público, `LEGAL_*` no ambiente). Páginas `/termos` e `/privacidade` (texto em `frontend/src/pages/Legal.tsx`; mudou o texto → mude `routers/legal.TERMS_VERSION`).
- Variáveis: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_PUBLIC_URL` (back_url e links), `LEGAL_COMPANY_NAME`, `LEGAL_DOCUMENT`, `LEGAL_CONTACT_EMAIL`, `LEGAL_CITY`; só para teste: `MP_API_BASE` (MP falso em `tests/fake_mercadopago.py`), `PAYMENT_GRACE_DAYS`. Guia do dono: `docs/COBRANCA-MERCADO-PAGO.md`.
- Testes: `tests/test_billing_limits_terms.py` (o ciclo completo de cobrança só roda com o MP falso).

## 10/10/2026 (2) — teste de 7 dias, página de vendas, planilha, leitor, WhatsApp
- Teste grátis de **7 dias** (`TRIAL_DAYS`); e-mails automáticos 3 dias e 1 dia antes de acabar (`run_billing_daily`).
- Cadastro instantâneo: a empresa nasce APROVADA em TESTE e o usuário já entra logado (sem aprovação do dono).
- `/` mostra a **página de vendas** (`pages/Landing.tsx`) para visitantes; logado vai para o painel. Preços/limites vêm de `GET /api/public/plans` (público). Imagens em `frontend/public/landing/`.
- Marca: **Estoque Pro** (10/10/2026). Nome da marca e WhatsApp do suporte centralizados em `frontend/src/lib/brand.ts`; botão flutuante `components/WhatsAppButton.tsx` (app e página de vendas; escondido no caixa).
- **Código de barras** opcional no produto (`barcode`, único por empresa quando preenchido). No caixa, o campo de busca já vem focado: o leitor digita o código + Enter e o produto entra no carrinho (busca exata por código de barras ou SKU).
- **Importar planilha**: `GET /api/products/import/template.xlsx`, `POST /api/products/import?dry_run=true|false` (.xlsx/.csv, cabeçalhos flexíveis, números no formato brasileiro, upsert por SKU, respeita limite do plano, até 5.000 linhas). Testes: `tests/test_import_barcode.py`.
