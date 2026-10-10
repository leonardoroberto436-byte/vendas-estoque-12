# Ligar a cópia dos backups fora do servidor

O sistema já faz backup sozinho todo dia às 6h. Mas, sem esta configuração, os
backups ficam **no mesmo servidor** do site: se o servidor tiver um problema, eles
somem junto. Com a cópia externa, cada backup também é guardado num
armazenamento seu, separado do Emergent.

Funciona com qualquer armazenamento compatível com S3. O mais simples e barato
é o **Cloudflare R2** (tem plano gratuito, mais que suficiente para este sistema).

## 1. Criar o armazenamento (Cloudflare R2)

1. Crie uma conta grátis em https://dash.cloudflare.com
2. No menu, abra **R2 Object Storage** e ative o R2 (pode pedir um cartão, mas o
   uso deste sistema fica dentro do gratuito).
3. Clique em **Create bucket**, dê o nome `backups-vendas-estoque` e crie.
4. Volte em **R2** → **Manage R2 API Tokens** → **Create API token**:
   - Permissão: **Object Read & Write**
   - Restrinja ao bucket `backups-vendas-estoque`
5. Ao criar, a Cloudflare mostra **uma única vez**:
   - **Access Key ID**
   - **Secret Access Key**
   - o endereço **S3 API** (algo como `https://<numero>.r2.cloudflarestorage.com`)

   Copie os três para um lugar seguro. **Não cole esses valores em nenhum chat.**

## 2. Colocar as chaves no Emergent

No Emergent, abra o app → **Manage Publishes** → **Secrets** e adicione:

| Nome | Valor |
|---|---|
| `BACKUP_S3_BUCKET` | `backups-vendas-estoque` |
| `BACKUP_S3_ENDPOINT` | o endereço S3 API do passo 5 |
| `BACKUP_S3_ACCESS_KEY_ID` | o Access Key ID |
| `BACKUP_S3_SECRET_ACCESS_KEY` | o Secret Access Key |
| `BACKUP_S3_REGION` | `auto` |

Depois **republique** o app.

## 3. Conferir

No painel do dono (`/plataforma`), em **Backups do banco**, clique em **Gerar
agora**. O aviso amarelo some e o backup novo aparece com **"cópia externa ok"**.
No Cloudflare, o arquivo aparece dentro do bucket.

## Restaurar os dados de uma loja

No painel do dono, em **Backups do banco**, clique em **Restaurar** no backup
desejado, escolha a empresa, clique em **Conferir** e depois em **Restaurar
agora**. Antes de restaurar, o sistema faz um backup do estado atual, então dá
para voltar atrás.

Para restaurar uma empresa que foi **excluída** (ela não aparece mais na lista)
ou o banco inteiro, use no servidor:

```bash
cd /app/backend
python restore_backup.py /app/backups/ARQUIVO.tar.gz --org ID_DA_EMPRESA        # simula
python restore_backup.py /app/backups/ARQUIVO.tar.gz --org ID_DA_EMPRESA --yes  # grava
```

Um arquivo baixado do R2 pode ser copiado para `/app/backups/` e restaurado do
mesmo jeito.
