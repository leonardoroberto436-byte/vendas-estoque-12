# Auditoria de Segurança — SaaS Estoque & Vendas Pro
Data: 09/10/2026 · Escopo: isolamento multiempresa (multi-tenant) e permissões
Ambiente testado: pré-produção (preview) — **nenhum teste destrutivo em dados reais**
Backup antes de qualquer alteração: `/app/backups/20261009-172408` (mongodump, 11 coleções)
Restauração testada: restaurada em banco temporário `restore_test`, contagem idêntica em todas as coleções, banco temporário descartado

## 1. Resumo executivo

| Item | Situação |
|---|---|
| Isolamento de dados entre empresas | **Aprovado** — 0 vazamentos em 21 tentativas de IDOR |
| Administração global restrita ao dono | **Aprovado** |
| Permissões do vendedor no servidor | **Falha encontrada e corrigida** (ver A-01) |
| Bloqueio de empresa / sessões abertas | **Aprovado** — sessão existente é revogada |
| Senhas e segredos expostos | **Aprovado** — nada em respostas, código ou logs |
| Configuração (CORS, endpoints de teste, cookie, força bruta) | **4 falhas encontradas e corrigidas** |
| Backup e restauração | **Aprovado com ressalva** — funciona, mas é manual |

Veredito: as falhas de **alto impacto encontradas foram corrigidas e reverificadas**. Pendências para comercializar com segurança estão na seção 6.

## 2. Falhas encontradas e corrigidas

| # | Severidade | Falha | Evidência (antes) | Correção aplicada | Evidência (depois) |
|---|---|---|---|---|---|
| A-01 | **ALTA** | Nenhuma rota de negócio verificava o **papel** do usuário — só a empresa. Um vendedor (OPERADOR) podia **criar, editar e excluir produtos** e **ajustar estoque manualmente** (permite mascarar desvio de mercadoria). | `DELETE /api/products/{id}` com sessão de OPERADOR → **204** (esperado 403); `POST /api/products` → **201**; `POST /api/stock/movements` (AJUSTE_POSITIVO) → aceito | `require("products:write")` em POST/PUT/DELETE de produtos, `require("stock:write")` em movimentações, `require("sales:create")` em vendas e `require("returns:create")` em devoluções. Papel OPERADOR passou a ter apenas `shop:read`, `sales:create`, `returns:create`, `reports:read`. Botões correspondentes escondidos para o vendedor. | mesmas requisições → **403** · venda do vendedor → **201** · leitura de produtos → **200** |
| A-02 | MÉDIA | `CORS_ORIGINS="*"` com `allow_credentials=true`: a API refletia qualquer origem, permitindo que um site externo chamasse a API com o cookie da vítima (hoje freado pelo `SameSite=Lax`, mas é configuração perigosa). | `curl -H "Origin: https://site-malicioso.example"` → `access-control-allow-origin: https://site-malicioso.example` | `CORS_ORIGINS` passou a listar apenas a origem do app; origens vazias não são mais aceitas. | origem maliciosa → **nenhum** `access-control-allow-origin`; origem do app → liberada |
| A-03 | MÉDIA | Sem limite de tentativas em `/auth/login` e `/auth/forgot-password` → força bruta de senha e de token. | 50 tentativas seguidas, todas respondidas com 401 | `lib/throttle.py`: 8 tentativas / 5 min por IP+conta no login (zeradas no acerto) e 5 / 15 min no esqueci-senha. | tentativas 1-8 → 401, tentativa 9 → **429 + Retry-After** |
| A-04 | BAIXA | Cookie de sessão sem a flag `Secure` — podia trafegar em http:// num downgrade. | `set-cookie: ev_session=…; HttpOnly; SameSite=lax` | `secure=True` adicionado. | `set-cookie: … Secure; HttpOnly; SameSite=lax` |
| A-05 | BAIXA | Endpoints de exemplo `GET/POST /api/status` abertos, sem autenticação, gravando no banco sem limite. | `GET /api/status` → **200** sem login | rotas removidas. | `GET /api/status` → **404** |

## 3. Testes automatizados — `backend/tests/test_tenant_isolation.py`

**Resultado: 50 de 50 aprovados** (`python -m pytest tests/`, 2 workers, 16 s).
Cobrem: cadastro público, aprovação, SKU duplicado entre empresas, produto/venda/estoque/devolução/relatório/log por empresa, troca de ID na URL, `org_id` injetado no corpo da requisição (ignorado), cookie de sessão adulterado, dono da plataforma sem acesso a loja, admin de loja sem acesso à plataforma, admin tentando criar um PLATFORM_OWNER, vendedor tentando se promover, assinatura cancelada x inadimplente, e integridade dos dados migrados da loja original.
Correção aplicada na suíte: passou a falar HTTPS (cookie agora é `Secure`) e o plano antigo `BASICO` foi atualizado para `INICIAL`.

## 4. Testes manuais/dinâmicos — `backend/audit_dynamic.py`

Script criado para esta auditoria. Cria **duas empresas fictícias** ("Empresa Alfa" e "Empresa Beta", domínio `@auditoria-exemplo.com`), cada uma com um **ADMIN** e um **OPERADOR**, executa requisições reais contra a API pública e **apaga tudo que criou no final**. Nenhuma credencial real é usada nos testes de empresa e nenhuma é exibida no relatório.

**Resultado: 66 de 66 aprovados.** Tabela completa (teste · esperado · obtido) impressa pelo script; resumo por bloco:

| Bloco | Testes | Resultado |
|---|---|---|
| Login (4 papéis + senha errada) | 5 | 5 aprovados (401 na senha errada) |
| Dados por empresa (criação e listagem) | 3 | 3 aprovados — listagem de A nunca contém item de B |
| **IDOR trocando IDs na URL** (produto, estoque, venda, devolução, usuário, senha de usuário) via GET/PUT/DELETE/POST | 11 | 11 aprovados — **todos 404**, nenhum 200, nenhuma alteração cruzada |
| Permissões do vendedor | 10 | 10 aprovados — 403 em usuários, logs, marca, catálogo e ajuste de estoque; 200/201 em ler produtos, painel e registrar venda |
| Administração global | 17 | 17 aprovados — admin/vendedor de empresa → 403 em todas as rotas `/platform/*`; dono → 200; dono → **403** em todos os dados de loja |
| Bloqueio de empresa e sessões | 6 | 6 aprovados — sessão já aberta vira **401** imediatamente após a suspensão; novo login → 403; assinatura cancelada → 403; usuário desativado perde a sessão |
| Segredos em respostas | 1 | aprovado — nenhum `password_hash`, senha, token ou segredo em `/auth/me`, `/users`, `/platform/users`, `/platform/organizations` |
| Acesso anônimo e webhook do cron | 8 | 8 aprovados — 401 em tudo; cron sem token e com token errado → 401 (comparação à prova de timing) |

## 5. Verificações de código (revisão, não teste)

- Toda consulta de negócio passa por `scoped(principal, …)` em `lib/auth.py`; o `org_id` vem **sempre** da sessão (cookie httpOnly) e nunca do corpo, da query ou da URL. Não há consulta a coleção de negócio fora desse caminho.
- Senhas: PBKDF2-SHA256 com 240.000 iterações e sal por usuário; apenas o hash é gravado.
- Token de recuperação: 256 bits, gravado apenas como hash SHA-256, uso único, expira em 30 min, invalida os anteriores.
- Nenhum segredo fixo no código: `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`, chave de e-mail e `WEBHOOK_CRON_SECRET` vêm de variáveis de ambiente.
- Logs do servidor: sem senhas, sem tokens, sem cookies.

## 6. Itens NÃO verificados / pendências para comercializar

| Item | Por quê | Recomendação |
|---|---|---|
| Ambiente de produção publicado | A auditoria rodou no ambiente de pré-produção; o ambiente publicado tem banco e variáveis próprias | Repetir `audit_dynamic.py` apontando para o domínio publicado e conferir `CORS_ORIGINS` e `WEBHOOK_CRON_SECRET` lá |
| Backup automático | Existe backup manual com restauração testada, mas **sem agendamento, sem retenção e sem cópia fora do servidor** | Agendar mongodump diário + cópia externa + teste de restauração mensal |
| Limite de tentativas em escala | A trava é por processo (um pod). Com vários pods, cada um conta separado | Mover para contador compartilhado (Redis) quando houver mais de um pod |
| Registro de auditoria de ações do dono | Há log de acesso por empresa, mas ações do dono (suspender, trocar plano, redefinir senha de cliente) não geram registro | Gravar log das ações em `/platform/*` |
| Cobrança e dados de pagamento | Não existe integração de pagamento — nada a auditar | Ao integrar, nunca gravar dados de cartão; usar provedor (Stripe/Mercado Pago) |
| Teste de carga / negação de serviço | Fora do escopo pedido | Avaliar antes de vender para muitas empresas |
| Revisão de dependências (CVEs) | Fora do escopo pedido | Rodar verificação de vulnerabilidades das bibliotecas periodicamente |

## 7. Como reproduzir

```bash
cd /app/backend
set -a && . ./.env && set +a
python -m pytest tests/                                   # 50 testes automatizados
python audit_dynamic.py https://<dominio-do-app>          # 66 testes dinâmicos
```
