# Ligar a cópia dos backups fora do servidor (Backblaze B2, grátis, sem cartão)

O backup roda todo dia às 6h. No Render grátis os arquivos do servidor somem quando
ele reinicia, e o banco grátis do Atlas não tem backup próprio. Por isso a cópia
externa é obrigatória: cada backup também vai para um armazenamento seu.

Funciona com qualquer armazenamento compatível com S3 (Backblaze B2, Cloudflare R2, AWS S3).

## 1. Criar o armazenamento (Backblaze B2)

1. Crie uma conta grátis em https://www.backblaze.com/sign-up/cloud-storage (10 GB grátis, sem cartão).
2. **Buckets → Create a Bucket**: nome `backups-estoque-pro`, **Private**, criptografia **Enable**.
3. Anote o **Endpoint** do bucket (algo como `s3.us-east-005.backblazeb2.com`).
4. **Application Keys → Add a New Application Key**:
   - Nome: `estoque-pro-backup`
   - Acesso só ao bucket `backups-estoque-pro`, tipo **Read and Write**
5. A Backblaze mostra **uma única vez** o `keyID` e o `applicationKey`. **Não cole em chat.**

## 2. Colar no Render (estoque-pro-api → Environment)

| Nome | Valor |
|---|---|
| `BACKUP_S3_BUCKET` | `backups-estoque-pro` (já vem preenchido) |
| `BACKUP_S3_ENDPOINT` | `https://` + o Endpoint do passo 3 |
| `BACKUP_S3_ACCESS_KEY_ID` | o keyID |
| `BACKUP_S3_SECRET_ACCESS_KEY` | o applicationKey |
| `BACKUP_S3_REGION` | `auto` (a região é lida do endereço) |

Salve com **Save, rebuild and deploy**. Depois, no painel do dono → Backups → **Gerar agora**:
a linha do backup deve mostrar "cópia externa ok".
