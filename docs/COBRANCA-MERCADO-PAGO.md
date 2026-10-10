# Ligar a cobrança automática (Mercado Pago)

Com isso ligado, a loja assina pela tela **Minha assinatura**, cadastra o cartão
no Mercado Pago e é cobrada todo mês sozinha. O sistema:

- ativa a loja quando o Mercado Pago confirma a assinatura;
- marca **inadimplente** e manda e-mail quando um pagamento é recusado;
- avisa um dia antes e **suspende após 5 dias** sem pagamento;
- **libera sozinho** assim que o pagamento é aprovado;
- deixa a loja usar até o fim do período pago quando ela cancela.

Enquanto isso não estiver configurado, a tela Minha assinatura mostra
"fale com o suporte" e você continua cobrando como hoje (link/Pix).

## 1. Criar a aplicação no Mercado Pago

1. Entre em https://www.mercadopago.com.br/developers com a conta que vai
   **receber** o dinheiro (de preferência a conta da empresa, com CNPJ).
2. **Suas integrações → Criar aplicação**. Tipo de pagamento: **Assinaturas**.
3. Em **Credenciais de teste**, copie o **Access Token** (começa com `TEST-`).

## 2. Configurar o aviso automático (webhook)

1. Na aplicação, abra **Webhooks → Configurar notificações**.
2. URL (modo teste e produção):
   `https://SEU-ENDERECO-PUBLICADO/api/billing/webhook`
   (o endereço do site publicado, o mesmo que os clientes usam).
3. Eventos: marque **Planos e assinaturas** (assinaturas e pagamentos autorizados).
4. Salve e copie a **Assinatura secreta** que aparece.

## 3. Colocar as chaves no Emergent

No Emergent: app → **Manage Publishes → Secrets**. **Nunca cole essas chaves em
nenhum chat.**

| Nome | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token (primeiro o de teste, depois o de produção) |
| `MP_WEBHOOK_SECRET` | Assinatura secreta do webhook |
| `APP_PUBLIC_URL` | endereço publicado, ex.: `https://vendas-estoque-12.emergent.host` |
| `LEGAL_COMPANY_NAME` | nome da sua empresa (aparece nos Termos) |
| `LEGAL_DOCUMENT` | seu CNPJ ou CPF |
| `LEGAL_CONTACT_EMAIL` | e-mail para clientes falarem com você (privacidade/suporte) |
| `LEGAL_CITY` | sua cidade/UF (foro dos Termos) |

Republique o app depois de salvar.

## 4. Testar antes de cobrar de verdade

1. No Mercado Pago Developers, crie **contas de teste** (um vendedor e um comprador).
2. Entre no sistema com uma loja de teste, abra **Minha assinatura**, escolha um
   plano e use a conta **compradora de teste** e um cartão de teste do Mercado Pago.
3. Volte ao sistema: em alguns minutos a assinatura aparece como **Ativo**.
4. No seu painel do dono, a empresa mostra "Mercado Pago: cartão ativo".

Quando estiver tudo certo, troque o `MP_ACCESS_TOKEN` pelo de **produção** (e
configure o webhook de produção com a mesma URL) e republique.

## Observações

- O pagamento acontece no site do Mercado Pago — o sistema nunca vê o número do cartão.
- O Mercado Pago tenta de novo até 4 vezes quando um cartão é recusado; se a loja
  ficar 5 dias sem pagar, o sistema suspende (os dados continuam guardados).
- Preços e limites dos planos você muda no painel do dono. Uma assinatura já
  criada só muda de valor quando a loja troca de plano.
- Cupom **FUNDADOR**: 50% de desconto para sempre, nas 10 primeiras lojas.
