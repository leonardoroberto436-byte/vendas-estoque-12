# Mudança de servidor: Emergent → Cloudflare + Render + MongoDB Atlas

O site atual (Emergent) continua no ar até o último passo. Nenhum cliente fica sem sistema.

| Parte | Onde | Arquivo de configuração |
|---|---|---|
| Site + telas do sistema | Cloudflare Pages (pasta `frontend`) | `frontend/functions/api/[[path]].js`, `frontend/public/_headers` |
| Servidor (API) | Render | `render.yaml` |
| Banco de dados | MongoDB Atlas (grátis, M0) | — |
| Cópia dos backups | Cloudflare R2 | ver `docs/BACKUP-EXTERNO.md` |
| E-mails | Brevo | — |
| Backup diário e avisos de cobrança | GitHub Actions | `.github/workflows/tarefas-automaticas.yml` |

## Regras de segurança

- Senhas e chaves **nunca** vão para o GitHub nem para chat. Ficam só nos painéis (Render, Cloudflare, GitHub Secrets).
- O servidor do Render só aceita chamadas que passam pelo Cloudflare (`PROXY_SHARED_SECRET`). Chamadas diretas recebem 403.
- O IP real do visitante vem do Cloudflare (`cf-connecting-ip`) e não pode ser falsificado, então o limite de tentativas de login funciona.
- Senhas dos usuários ficam no banco como hash bcrypt. Sessões e links de senha ficam como hash SHA-256.
- O banco no Atlas só aceita conexão com usuário e senha fortes (gerados pelo Atlas).

## Ordem

1. **MongoDB Atlas**: criar cluster M0 grátis (AWS, N. Virginia), usuário do banco com senha gerada e acesso de rede `0.0.0.0/0` (o Render grátis não tem IP fixo; a proteção é a senha forte). Copiar a connection string.
2. **Render**: New → Blueprint → este repositório. Colar `MONGO_URL` e os demais valores secretos. `PLATFORM_OWNER_EMAIL` = o mesmo e-mail de dono de hoje; `PLATFORM_OWNER_PASSWORD` = uma senha provisória (ela é trocada pela antiga ao restaurar).
3. **Cloudflare Pages**: Create → Connect to Git → este repositório. Root directory `frontend`, build `npm run build`, output `dist`. Variáveis (tipo Secret): `BACKEND_URL` (endereço do Render) e `PROXY_SHARED_SECRET` (copiar do Render).
4. **Restaurar os dados**: entrar no endereço `*.pages.dev` com o dono provisório → Plataforma → Backups → enviar o arquivo `.tar.gz` → "Restaurar tudo" → confirmar. Depois entrar com a senha antiga.
5. **Testar** no `*.pages.dev`: login, venda, estoque, relatório, cadastro de teste, e-mail de recuperação de senha.
6. **Brevo**: verificar o remetente (`EMAIL_FROM_ADDRESS`) e colar `BREVO_API_KEY` no Render.
7. **R2**: criar bucket e chaves (ver `docs/BACKUP-EXTERNO.md`) e colar no Render.
8. **GitHub Actions**: criar os secrets `APP_URL` e `WEBHOOK_CRON_SECRET` (copiar do Render). Rodar uma vez à mão ("Run workflow").
9. **Monitor grátis** (UptimeRobot, a cada 5 min, em `https://estoquevendaspro.com/api/public/plans`): avisa se cair e evita o servidor grátis "dormir".
10. **Domínio**: apontar `estoquevendaspro.com` para o Cloudflare Pages. Só depois disso, atualizar o webhook do Mercado Pago (o endereço continua o mesmo, mas conferir que chega).
11. Último backup no Emergent → enviar e restaurar de novo no servidor novo (pega o que mudou no meio-tempo) → desligar o Emergent.
