# Gateway de pagamento — Mercado Pago (Pix)

## Por que um gateway

Uma chave Pix estática (ex.: CPF `13786508917`) recebe o dinheiro, mas não
avisa o sistema **quem** pagou **qual** pedido. Por isso o modo recomendado é
uma **cobrança Pix individual por pedido**, criada pelo gateway, com
identificador único, QR Code/copia e cola próprios, webhook assinado e
consulta de status. O modo manual (chave estática) continua disponível como
fallback, sempre com conferência humana.

## Fonte do contrato (nada foi inventado)

A integração segue a **API de Pagamentos** do Mercado Pago. O contrato foi
conferido no **SDK oficial** `mercadopago` (npm, v3.6.1 — implementação de
referência mantida pelo Mercado Pago) e na documentação oficial para
desenvolvedores (Pagamentos: criar, obter e buscar; Webhooks: validação da
origem da notificação). O cliente fica em
`src/server/payments/gateway/mercadopago.ts`.

| Operação | Chamada | Uso no sistema |
|---|---|---|
| Criar cobrança Pix | `POST /v1/payments` + `X-Idempotency-Key` | ao criar o pedido (modo automático) |
| Consultar | `GET /v1/payments/{id}` | webhook, página do pedido, conciliação, expiração |
| Buscar por referência | `GET /v1/payments/search?external_reference=…` | recuperar cobrança criada sem id salvo (queda no meio da criação) |
| Cancelar pendente | `PUT /v1/payments/{id}` `{"status":"cancelled"}` | antes de liberar números de pedido expirado/cancelado |

Todas as chamadas: `Authorization: Bearer <Access Token>`, tempo limite de
10 s, respostas validadas (valor com no máximo 2 casas decimais, referência,
moeda).

### Corpo da criação

```json
{
  "transaction_amount": 14.70,
  "description": "Campanha do Alek - Pedido ALEK-20260928-000001",
  "payment_method_id": "pix",
  "external_reference": "ALEK-20260928-000001",
  "date_of_expiration": "2026-09-28T15:30:00.000-03:00",
  "notification_url": "https://SEU-DOMINIO/api/webhooks/pix",
  "payer": { "email": "comprador@exemplo.com", "first_name": "Maria", "last_name": "da Silva" },
  "metadata": { "order_code": "ALEK-20260928-000001" }
}
```

- Valor: o sistema trabalha em centavos (`1470`) e converte só na borda
  (`14.70`); a volta recusa valores com mais de 2 casas.
- `external_reference` = código do pedido (identificação única). A resposta é
  conferida: referência e valor precisam bater com o pedido, e o BR Code
  devolvido é validado (CRC16 e valor) antes de ser mostrado ao comprador.
- `payer.email` é exigido pelo gateway: no modo automático o checkout pede
  e-mail.
- Validade: no mínimo `MERCADOPAGO_PIX_MIN_EXPIRATION_MINUTES` (padrão 30).
  Se a cobrança durar mais que a reserva, ela é **cancelada no gateway antes**
  de os números serem liberados.

### Idempotência

- Cada pedido tem um registro de pagamento com chave fixa
  (`order:<id>:1`), enviada em `X-Idempotency-Key`: repetir a criação
  (clique duplo, nova tentativa, conciliação) devolve a **mesma** cobrança.
- Um "lease" de 30 s evita chamadas simultâneas para o mesmo pedido; nenhuma
  transação do banco fica aberta durante a chamada HTTP.
- Se o gateway recusar os dados (erro 4xx de validação), o pedido vai para
  `ERROR` e os números são liberados; falhas temporárias mantêm o pedido e a
  conciliação tenta de novo.

### Mapeamento de status

| Mercado Pago | Sistema | Efeito |
|---|---|---|
| `approved` | `APPROVED` | confirma pedido e números (se referência e **valor exato** conferem) |
| `pending`, `in_process`, `authorized`, `in_mediation`, desconhecido | `PENDING` | nada muda |
| `rejected` | `REJECTED` | registra; pedido segue pendente até expirar |
| `cancelled` | `CANCELLED` | libera os números (se o pedido ainda estiver pendente) |
| `refunded`, `charged_back` | `REFUNDED` / `CHARGED_BACK` | números do pedido pago vão para `CANCELLED`; pendência administrativa |

Casos especiais tratados por `applyGatewayPayment` (idempotente, com o pedido
e o pagamento travados):

- valor pago diferente do total → **não confirma**; `PAYMENT_AMOUNT_MISMATCH`
  e pendência administrativa;
- segundo pagamento aprovado para pedido já pago → `DUPLICATE_PAYMENT`
  (devolução);
- pagamento após a expiração → recupera os **mesmos** números se ainda
  estiverem livres; se algum já foi vendido → `LATE_PAYMENT_CONFLICT`
  (devolução; nunca "rouba" número de outra pessoa).

## Credenciais

1. No painel de desenvolvedor do Mercado Pago (**Suas integrações**), crie ou
   escolha a aplicação da campanha.
2. Copie o **Access Token** de produção para `PAYMENT_API_KEY` (ou salve em
   **Configurações → Pagamentos**, onde fica criptografado com AES-256-GCM e
   nunca volta para o navegador). Variável de ambiente tem precedência.
3. Nunca coloque o token no frontend, em repositório ou em mensagens.
4. `PAYMENT_GATEWAY=mercadopago`.

Para testes, use as credenciais de teste e as contas de teste da própria
aplicação no Mercado Pago, ou o simulador local (abaixo).

## Webhook

1. Em **Suas integrações → (aplicação) → Webhooks**, cadastre
   `https://SEU-DOMINIO/api/webhooks/pix` para eventos de **pagamentos**.
2. Copie a **assinatura secreta** para `PAYMENT_WEBHOOK_SECRET` (ou salve no
   painel). O sistema aceita o segredo do ambiente e o do painel ao mesmo
   tempo, o que permite trocar o segredo sem perder notificações.
3. Validação (em `verifyMercadoPagoSignature`): o header
   `x-signature: ts=…,v1=…` deve ser o HMAC-SHA256 do manifesto
   `id:{data.id};request-id:{x-request-id};ts:{ts};` (partes ausentes são
   omitidas), comparado em tempo constante. `data.id` vem da URL da
   notificação.
4. Depois de validar, o sistema **sempre consulta o pagamento na API**; o
   corpo da notificação nunca é usado como fonte de verdade.
5. Deduplicação por `x-request-id` + id do pagamento (índice único): o mesmo
   aviso 5 vezes é processado uma vez.
6. Respostas: `200` (processado ou já processado), `401` (assinatura
   inválida), `5xx` (falha temporária — o Mercado Pago reenvia), `413`, `429`.

Teste depois de configurar: faça uma compra de baixo valor em produção e
confirme em `/status` que "Último válido (assinatura OK)" foi atualizado e que
o pedido virou **Pago** sozinho.

## Rotinas que protegem o pagamento

| Rotina | Intervalo | O que faz |
|---|---|---|
| Conciliação | 60 s | consulta pedidos pendentes (com espaçamento por pedido) e cobranças sem id; confirma pagos — cobre webhook perdido |
| Expiração | 30 s | pedido vencido: consulta → se pago confirma; se pendente **cancela no gateway** e só então libera; gateway fora do ar → mantém a reserva |
| Página do pedido | a cada 5–10 s | a página consulta o sistema; o sistema consulta o gateway no máximo 1 vez a cada 15 s por pedido |

Execute pelo worker (`npm run worker` / serviço `worker` do Docker Compose)
ou por cron externo em `/api/cron/{expire,reconcile,cleanup}` com
`Authorization: Bearer $CRON_SECRET`.

## Reembolsos

O reembolso é feito no painel do Mercado Pago. O sistema recebe `refunded`
pelo webhook/conciliação e marca os números do pedido como `CANCELLED`, com
pendência para registro. Para pagamentos com pendência (valor divergente,
duplicado, tardio), use **Pagamentos → Tratar** no painel, com observação e
indicação de devolução.

## Simulador local (desenvolvimento e testes)

`npm run fake-gateway` sobe um simulador compatível com as chamadas acima
(porta 4010), inclusive a assinatura dos webhooks. Controle:

```
POST /__control/payments/:id/approve   {"paidAmount"?: number, "webhook"?: "valid"|"invalid"|"none"}
POST /__control/payments/:id/status    {"status": "...", "webhook"?: ...}
POST /__control/payments/:id/webhook   {"signature"?: "valid"|"invalid"}
POST /__control/mode                   {"down"?: boolean, "latencyMs"?: number}
GET  /__control/payments
```

É usado pelos testes de integração e E2E. **Nunca aponte produção para ele.**

## Checklist de produção do gateway

- [ ] Access Token **de produção** configurado; `MERCADOPAGO_API_BASE_URL` no padrão
- [ ] webhook cadastrado com a URL HTTPS pública e a assinatura secreta configurada
- [ ] `NEXT_PUBLIC_APP_URL` com `https://` (a URL de notificação é derivada dela)
- [ ] campanha em **modo automático** em Configurações → Pagamentos ("Gateway: configurado", "Webhook: ativo")
- [ ] worker/cron rodando (`/status` mostra "Última sincronização" recente)
- [ ] compra real de teste confirmada automaticamente e, se desejado, reembolsada
