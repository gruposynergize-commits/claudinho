# Arquitetura técnica — Sistema de Campanhas de Números

> Documento da Fase 1. Descreve as decisões antes da implementação e é mantido
> atualizado conforme o código evolui.

## 0. Análise do projeto existente

O repositório `claudinho` continha apenas arquivos de design (prompts de
imagem, SVG/PDF e scripts Python de vetorização do produto "Boto"). Não havia
stack web, banco ou código reaproveitável. O sistema foi criado como um projeto
isolado em `campanhas/`, sem tocar nos arquivos existentes.

Ambiente disponível: Node.js 22, PostgreSQL 16, Chromium (Playwright).

## 1. Princípios

Ordem de prioridade definida pelo cliente:

**CONFIABILIDADE > SEGURANÇA > CONSISTÊNCIA > PAGAMENTO > SORTEIO > UX > ESTÉTICA**

Consequências práticas:

1. **O banco é a última linha de defesa.** Toda regra crítica existe em dois
   lugares: no serviço (TypeScript) e no PostgreSQL (constraints, índices
   únicos parciais e triggers). Um bug na aplicação não consegue gravar um
   estado inválido.
2. **Nada crítico no navegador.** Preço, status, total e vencedor são sempre
   calculados no servidor a partir do banco. A API não aceita preço nem status
   vindos do cliente (schemas `strict`).
3. **Na dúvida, segurar o número.** Um número só volta a ficar disponível
   depois de confirmada, no gateway, a impossibilidade de pagamento. Se o
   gateway estiver fora do ar, a reserva é mantida (mais segura que vender duas
   vezes).
4. **Idempotência em tudo que envolve dinheiro.** Criação de pedido, criação de
   cobrança, webhook, conciliação e confirmação manual podem ser repetidos sem
   efeito duplicado.
5. **Histórico imutável.** Auditoria, snapshot do sorteio e resultado são
   protegidos por triggers contra UPDATE/DELETE.

## 2. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4 | Pedido do cliente; SSR para página pública rápida em mobile |
| Backend | Route Handlers do Next.js (Node runtime) + camada de serviços em `src/server` | Lógica crítica isolada e testável sem HTTP |
| Banco | PostgreSQL 16 | Transações, row-level locking, constraints, triggers |
| ORM | Prisma 7 (driver adapter `pg`) | Pedido do cliente; SQL puro parametrizado nos trechos críticos |
| Validação | Zod 4 | Schemas estritos em todas as entradas |
| Pix | Mercado Pago (Payments API) + BR Code estático próprio | Ver `docs/GATEWAY-MERCADOPAGO.md` |
| Testes | Vitest (unitário + integração com PostgreSQL real) e Playwright (E2E mobile) | Concorrência precisa de banco real |
| Jobs | Worker Node (`scripts/worker.ts`) e/ou endpoints `/api/cron/*` com segredo | Funciona em VPS/Docker e em serverless |

## 3. Visão geral

```
 Navegador (mobile)                         Mercado Pago
   │  páginas públicas / checkout             │   ▲
   ▼                                          │   │ cria cobrança, consulta,
 Next.js ── proxy.ts (headers, CSP nonce)     │   │ cancela (Bearer + X-Idempotency-Key)
   │                                          ▼   │
   ├── /api/public/*   ──┐           /api/webhooks/pix (HMAC x-signature)
   ├── /api/admin/*    ──┤                    │
   └── /api/cron/*     ──┤                    │
                         ▼                    ▼
                 src/server (serviços de domínio)
                 ├─ numbers/      reservas, máquina de estados
                 ├─ orders/       pedidos, expiração
                 ├─ payments/     gateway, webhook, conciliação, BR Code
                 ├─ draw/         snapshot, hash, métodos de apuração
                 ├─ audit/        AuditLog encadeado por hash
                 ├─ auth/         sessões, papéis, senhas (scrypt)
                 └─ security/     rate limit, origem, sanitização
                         │
                         ▼
                 PostgreSQL (constraints + triggers)

 Worker (a cada 30–60 s): expira reservas, expira pedidos (consultando o
 gateway antes), concilia pagamentos pendentes, limpa rate limits.
```

## 4. Modelo de dados

Tabelas principais (nomes físicos em snake_case):

| Tabela | Função | Proteções no banco |
|---|---|---|
| `users` | administradores | e-mail único (minúsculo), papel `ADMIN/OPERATOR/VIEWER` |
| `sessions` | sessões do painel | id = SHA-256 do token (token nunca é salvo) |
| `campaigns` | campanha | slug único, preço em centavos `> 0`, trigger de transição de status |
| `campaign_numbers` | 1 linha por número | `UNIQUE(campaign_id, number)`, CHECK de coerência status × vínculos, trigger de transição |
| `reservations` | reserva temporária do carrinho | token hash único, expiração |
| `customers` | compradores | telefone único entre ativos, CPF criptografado (opcional) |
| `orders` | pedidos | código único, cliente obrigatório (FK NOT NULL), `total = unitário × quantidade` (CHECK), trigger de transição |
| `order_items` | números do pedido | pedido obrigatório; **índice único parcial**: um número só pode estar em um item ativo |
| `payments` | cobranças | `UNIQUE(gateway, gateway_payment_id)`, `UNIQUE(idempotency_key)`, pedido obrigatório |
| `payment_events` | eventos (webhook, conciliação, manual) | `UNIQUE(dedupe_key)` |
| `prizes` | prêmios | ordem única por campanha, origem `NOT_INFORMED` por padrão |
| `draws` | sorteio | um por campanha, trigger de transição |
| `draw_snapshots` | lista congelada + hash | trigger: imutável; campos de resultado só podem ser preenchidos uma vez |
| `draw_results` | vencedor por prêmio | trigger: número vencedor imutável; `UNIQUE(draw_id, prize_id)` e `UNIQUE(draw_id, winner_number)` |
| `audit_logs` | auditoria | append-only (trigger bloqueia UPDATE/DELETE) + cadeia de hash |
| `legal_information` | informações legais | 1 por campanha |
| `payment_settings` | configuração Pix | segredos criptografados (AES-256-GCM), nunca retornados à UI |
| `system_logs` | observabilidade | filtros por nível/categoria/data |
| `rate_limits` | limites por janela | chave + janela |
| `system_state` | última sincronização etc. | chave/valor |

Dinheiro: sempre inteiro em centavos (`price_cents = 490`). Conversão para
decimal só na borda do gateway (`14.70`), com teste de ida e volta.

## 5. Estados

### 5.1 Número (`campaign_numbers.status`)

```
AVAILABLE ──reservar──▶ RESERVED ──checkout──▶ PENDING_PAYMENT ──pagamento confirmado──▶ PAID
    ▲                      │                         │                                     │
    └──── expirou/liberou ─┘                         │                           execução do sorteio
    ▲                                                │                                     ▼
    └── expirou/cancelado (após consultar gateway) ──┘                                   DRAWN
                                                                                 homologação ▼
                                                                                         WINNER
Exceções (somente com motivo + AuditLog, flag transacional exigida pelo trigger):
  AVAILABLE → CANCELLED (bloquear)   CANCELLED → AVAILABLE (desbloquear)
  PAID → CANCELLED (reembolso/estorno)
```

`PAID → AVAILABLE` é **impossível**: o trigger rejeita mesmo com a flag de
exceção. Com a campanha congelada (`FROZEN`/`DRAWN`), o trigger só aceita as
transições do próprio sorteio.

### 5.2 Pedido (`orders.status`)

`PENDING_PAYMENT → PAID | EXPIRED | CANCELLED | ERROR`;
`EXPIRED/CANCELLED/ERROR → PAID` apenas pelo fluxo de pagamento tardio (se todos
os números ainda estiverem livres); `PAID → REFUNDED` apenas por exceção
auditada. Qualquer outra transição é rejeitada pelo trigger.

### 5.3 Campanha

`DRAFT → ACTIVE ⇄ PAUSED → CLOSED → FROZEN → DRAWN`; `CLOSED → ACTIVE`
(reabrir, auditado); `CANCELLED` apenas sem pedidos pagos. `DRAWN` e `FROZEN`
nunca voltam para `ACTIVE`. Ativar exige informações legais preenchidas e uma
declaração explícita do administrador de que a operação está enquadrada.

## 6. Fluxo de reserva (concorrência)

1. Cliente escolhe números → `POST /api/public/campaigns/{slug}/reservations`.
2. Em uma transação:
   - `SELECT … FROM campaigns … FOR SHARE` (impede fechar vendas no meio);
   - `UPDATE campaign_numbers SET status='RESERVED', … WHERE campaign_id=$1
     AND number = ANY($2) AND status='AVAILABLE' RETURNING number`;
   - se a quantidade retornada for menor que a pedida → **ROLLBACK** (tudo ou
     nada) e resposta 409 com os números indisponíveis.
3. Por que funciona: no PostgreSQL, dois `UPDATE` na mesma linha se serializam
   pelo lock de linha; o segundo reavalia o `WHERE status='AVAILABLE'` depois
   do commit do primeiro e não altera nada. Não há janela entre "verificar" e
   "gravar".
4. Rede de segurança: índice único parcial em `order_items(campaign_number_id)
   WHERE active` — mesmo com bug na aplicação, um número não entra em dois
   pedidos ativos.

## 7. Fluxo de pedido e pagamento

1. `POST /api/public/orders` com o token da reserva, dados do cliente, aceites
   e uma chave de idempotência gerada no navegador.
2. Transação: trava a reserva, confere validade, busca **preço do banco**,
   cria cliente/pedido/itens, move números para `PENDING_PAYMENT`, cria o
   registro `payments` (status `CREATING`, chave de idempotência derivada do
   pedido).
3. Fora da transação: cria a cobrança Pix no gateway (`X-Idempotency-Key`).
   Falhou? O pedido continua válido e o cliente pode tentar de novo com a mesma
   chave; a conciliação também repete.
4. Confirmação (webhook, conciliação, consulta da página ou expiração) passa
   sempre pela mesma função `applyGatewayPayment`, que:
   - trava pedido e pagamento (`FOR UPDATE`);
   - confere referência externa, moeda e **valor exato**;
   - se já pago pelo mesmo pagamento → nada a fazer (idempotente);
   - se pago por outro pagamento → registra `DUPLICATE_PAYMENT` para reembolso;
   - valor diferente → `PAYMENT_AMOUNT_MISMATCH`, pedido **não** é confirmado;
   - pedido expirado/cancelado → tenta recuperar os mesmos números; se algum
     já foi vendido → `LATE_PAYMENT_CONFLICT` para tratamento administrativo.

## 8. Webhook

`POST /api/webhooks/pix`:
1. valida `x-signature` (HMAC-SHA256 do manifesto
   `id:{data.id};request-id:{x-request-id};ts:{ts};`, comparação em tempo
   constante) — inválido → 401 e log de segurança;
2. deduplica por `x-request-id`/id da notificação (tabela `payment_events`);
3. **consulta o pagamento na API do gateway** (o corpo do webhook nunca é
   usado como fonte de verdade);
4. aplica via `applyGatewayPayment` (idempotente);
5. falha ao consultar → 500 para o gateway reenviar; a conciliação também
   cobre.

## 9. Expiração e conciliação

- Reservas de carrinho expiradas: liberadas diretamente (não existe cobrança).
- Pedidos expirados (automático): consulta o gateway → se pago, confirma; se
  pendente, **cancela a cobrança** e só então libera; se o gateway falhar,
  mantém a reserva e tenta de novo.
- Pedidos no modo manual em que o cliente clicou "Já paguei" não expiram
  sozinhos: aguardam conferência administrativa.
- Conciliação periódica consulta pedidos pendentes (com backoff) e cobranças
  que ficaram em `CREATING` (busca por `external_reference`).

## 10. Sorteio

1. Fechar vendas (`CLOSED`).
2. Congelar (`FROZEN`): exige zero números `RESERVED/PENDING_PAYMENT`; cria
   `draw_snapshots` com a lista ordenada de números `PAID`, contagem, SHA-256,
   método oficial e referência oficial planejada (ex.: concurso da Loteria
   Federal). Snapshot imutável.
3. Executar: aplica o método configurado (Loteria Federal com regra
   documentada, hash verificável com amostragem por rejeição, ou
   `crypto.randomInt`), grava entrada, passos e resultado; números `PAID →
   DRAWN`. Execução única (trigger + transição condicional).
4. Homologar: recalcula o hash da lista gravada, confere elegibilidade de cada
   número sorteado (no snapshot, pedido pago, pagamento aprovado), move
   `DRAWN → WINNER`, registra vencedores e gera relatório. Campanha → `DRAWN`.

Não existe endpoint, formulário ou coluna editável para "digitar o vencedor".

## 11. Segurança

- Sessões opacas no banco (cookie HttpOnly, SameSite=Lax, Secure em produção),
  senha com scrypt (N=2^15, r=8, p=3), bloqueio após tentativas.
- RBAC: `VIEWER` (leitura, PII mascarada) < `OPERATOR` (vendas/atendimento) <
  `ADMIN` (configurações, sorteio, exceções, usuários).
- Mutação no painel exige `Origin` igual ao da aplicação (CSRF) + cookie
  SameSite.
- Rate limit no PostgreSQL (funciona com várias instâncias).
- CSP com nonce, HSTS, `frame-ancestors 'none'`, `nosniff`.
- SQL somente parametrizado (`$queryRaw` com template / Prisma).
- Erros para o usuário são mensagens amigáveis com código; detalhes só no log
  do servidor.

## 12. Privacidade (LGPD)

- Coleta mínima: nome, WhatsApp; e-mail opcional; CPF só se a campanha exigir
  (criptografado).
- Página pública e `/consultar` nunca exibem CPF, telefone, e-mail ou dados de
  outros compradores; consulta exige código do pedido **e** WhatsApp.
- Painel: exportação dos dados do titular, correção auditada, anonimização e
  rotina de retenção para pedidos não pagos.

## 13. Testes

- Unitários: dinheiro, BR Code/CRC16, máquinas de estado, métodos de sorteio,
  assinatura do webhook, validação de entrada.
- Integração (PostgreSQL real): concorrência (100 reservas simultâneas),
  pagamento (webhook duplicado, atrasado, inválido, valor errado, parcial,
  duplicado, gateway fora do ar, conciliação), triggers de imutabilidade,
  RBAC, sorteio.
- E2E (Playwright, emulação iPhone/Android no Chromium): jornada completa
  mobile e ações do painel.
