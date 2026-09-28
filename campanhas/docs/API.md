# Endpoints

Todas as respostas JSON seguem `{ ok: true, data }` ou
`{ ok: false, error: { code, message, details? }, requestId }` (mensagem
amigável; detalhes técnicos só no log do servidor). Corpos JSON têm limite de
tamanho e schemas estritos: campos desconhecidos (ex.: `priceCents`,
`status`) são recusados com `400`.

## Públicos

| Método | Rota | Função | Proteções |
|---|---|---|---|
| GET | `/api/public/campaigns/{slug}/numbers` | situação compacta dos números (1 caractere por número) | cache de 1–2 s; sem dados pessoais |
| POST | `/api/public/campaigns/{slug}/reservations` | reserva tudo-ou-nada (`numbers`, `replaceToken?`) | mesma origem; 60/10 min por IP; teto de números retidos por IP |
| POST | `/api/public/reservations/current` | consulta a reserva do token | 300/min por IP |
| POST | `/api/public/reservations/release` | desiste da reserva | 300/min por IP |
| POST | `/api/public/orders` | cria o pedido a partir da reserva (dados, aceites, `idempotencyKey`) | mesma origem; 30/10 min por IP; idempotente; preço do banco |
| GET | `/api/public/orders/{token}` | situação do pedido (consulta o gateway no máximo a cada 15 s) | token HMAC de 256 bits; 600/min por IP; sem telefone/e-mail/CPF |
| POST | `/api/public/orders/{token}/charge` | tenta de novo gerar a cobrança Pix (mesma chave de idempotência) | 30/10 min por IP |
| POST | `/api/public/orders/{token}/report-paid` | "Já paguei" (modo manual) — **não confirma** | 30/10 min por IP |
| POST | `/api/public/lookup` | consulta por código do pedido + WhatsApp | 30/10 min por IP e 8/10 min por código; resposta idêntica para qualquer erro |
| GET | `/api/public/draws/{drawId}/eligible` | lista elegível no formato canônico (confere com o SHA-256 publicado) | 300/min por IP; só números |
| POST | `/api/webhooks/pix` | notificações do Mercado Pago | assinatura HMAC; consulta obrigatória à API; deduplicação; 600/min por IP; corpo ≤ 64 KB |
| GET/POST | `/api/cron/{expire\|reconcile\|cleanup}` | rotinas para agendador externo | `Authorization: Bearer $CRON_SECRET`; lease no banco (sem execução simultânea) |

Páginas públicas: `/campanha/{slug}`, `/campanha/{slug}/numeros`,
`/campanha/{slug}/checkout`, `/campanha/{slug}/regulamento`,
`/campanha/{slug}/resultado`, `/pedido/{token}`, `/consultar`,
`/privacidade`, `/termos`.

## Painel (`/api/admin/*`)

Autenticação por cookie de sessão; toda mutação exige `Origin` da própria
aplicação (CSRF) e está limitada a 120/min por usuário. Permissões:
**A** = ADMIN, **O** = OPERATOR, **V** = VIEWER.

| Método | Rota | Permissão | Papéis |
|---|---|---|---|
| POST | `/api/admin/auth/login` | — (5 erros → bloqueio 15 min; 10/15 min por IP; 8/15 min por e-mail) | todos |
| POST | `/api/admin/auth/logout` | sessão | todos |
| POST | `/api/admin/me/password` | sessão (exige senha atual) | todos |
| GET | `/api/admin/campaigns/{id}/dashboard` | dashboard.view | A O V |
| PUT | `/api/admin/campaigns/{id}` | settings.manage (alteração crítica com vendas exige confirmação e motivo) | A |
| POST | `/api/admin/campaigns/{id}/status` | settings.manage (ativar exige declaração de conformidade) | A |
| POST | `/api/admin/campaigns/{id}/prizes` · DELETE `…/prizes/{prizeId}` | settings.manage (bloqueado após congelar) | A |
| PUT | `/api/admin/campaigns/{id}/legal` | settings.manage | A |
| GET · PUT | `/api/admin/campaigns/{id}/payment-settings` | settings.view · settings.manage (segredos nunca retornam) | A O V · A |
| POST | `/api/admin/campaigns/{id}/static-qr` | orders.manage ("Pix estático — confirmação manual") | A O |
| GET | `/api/admin/campaigns/{id}/export/{numeros\|compradores\|pedidos\|pagamentos\|auditoria}` | export.data (auditado) | A |
| GET · POST | `/api/admin/orders` | orders.view · orders.manage (reserva em nome do comprador) | A O V · A O |
| POST | `/api/admin/orders/{id}/confirm-payment` | payments.confirmManual (verificação, valor ≥ total, referência, motivo) | A O |
| POST | `/api/admin/orders/{id}/check` | payments.check (consulta o gateway agora) | A O |
| POST | `/api/admin/orders/{id}/cancel` | orders.manage (automático: cancela no gateway antes de liberar) | A O |
| POST | `/api/admin/orders/{id}/customer` | orders.manage (correção com motivo) | A O |
| POST | `/api/admin/orders/{id}/notes` | orders.manage | A O |
| POST | `/api/admin/orders/{id}/confirmation` | orders.manage (mensagem de WhatsApp) | A O |
| POST | `/api/admin/orders/{id}/refund` | orders.refund (exceção auditada) | A |
| POST | `/api/admin/payments/{id}/resolve` | payments.resolve | A |
| POST | `/api/admin/numbers/release` | numbers.manage | A O |
| POST | `/api/admin/numbers/block` · `/unblock` | numbers.exceptional (motivo) | A |
| POST | `/api/admin/customers/{id}` | customers.manage | A O |
| GET | `/api/admin/customers/{id}/export` | export.data (dados do titular) | A |
| POST | `/api/admin/customers/{id}/anonymize` | lgpd.anonymize | A |
| POST | `/api/admin/campaigns/{id}/draw/freeze` | draw.manage | A |
| POST | `/api/admin/draws/{drawId}/preview` | draw.manage (não grava) | A |
| POST | `/api/admin/draws/{drawId}/execute` | draw.manage (execução única) | A |
| POST | `/api/admin/draws/{drawId}/finalize` | draw.manage | A |
| POST | `/api/admin/draws/{drawId}/annul` | draw.manage (antes da homologação; motivo público) | A |
| GET | `/api/admin/draws/{drawId}/report` | draw.view (nomes mascarados sem permissão de dados pessoais) | A O V |
| POST | `/api/admin/draw-results/{resultId}/delivery` | draw.manage | A |
| POST | `/api/admin/audit/verify` | audit.view | A |
| GET | `/api/admin/status` · POST `/api/admin/jobs/{job}` | system.view | A |
| GET · POST | `/api/admin/users` · POST `/api/admin/users/{id}` · `/users/{id}/password` | users.manage (sempre resta ao menos um ADMIN ativo) | A |

Páginas do painel: `/admin` (dashboard), `/admin/pedidos`,
`/admin/pedidos/novo`, `/admin/pedidos/{id}`, `/admin/numeros`,
`/admin/compradores`, `/admin/pagamentos`, `/admin/sorteio`,
`/admin/sorteio/relatorio/{drawId}`, `/admin/configuracoes/*`,
`/admin/auditoria`, `/admin/sistema/logs`, `/admin/conta`, `/status`.
