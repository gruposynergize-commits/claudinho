# Checklist final (item 68) — respostas com evidência

Legenda das evidências: `int/` = `tests/integration`, `unit/` =
`tests/unit`, `e2e/` = `tests/e2e`. Todos os testes citados passam
(unitários + integração: 115; E2E: 14).

## Números

**Dois usuários podem comprar o mesmo número? — Não.**
A reserva é um `UPDATE … WHERE status='AVAILABLE'` atômico e tudo-ou-nada; o
PostgreSQL serializa as tentativas na mesma linha. O índice único parcial em
`order_items (campaign_number_id) WHERE active` impede o mesmo número em dois
pedidos mesmo com bug na aplicação.
Evidência: `int/reservations` "100 requisições simultâneas pelo mesmo número:
1 reserva, 99 falhas controladas" e "seleções sobrepostas concorrentes nunca
compartilham números"; `int/orders` "fluxo completo concorrente: 50
compradores, mesmo número → 1 pedido"; `e2e/concurrency` (100 requisições HTTP
com IPs distintos → 1×201, 99×409); verificação manual via HTTP no build de
produção (mesmo resultado).

**Um número pago pode voltar a ficar disponível? — Não.**
O trigger de estados rejeita `PAID → AVAILABLE` sempre (mesmo com a flag de
exceção). Reembolso leva o número a `CANCELLED`, nunca a `AVAILABLE`, com
auditoria. Com a campanha congelada, nenhum número muda (só as transições do
próprio sorteio).
Evidência: `int/payments` "estorno de pedido pago: números vão para CANCELLED
(nunca voltam a AVAILABLE)"; `int/draw` "depois de congelar: … " (UPDATE
direto para AVAILABLE recusado pelo banco).

**Uma reserva expirada pode causar inconsistência? — Não.**
Reserva de carrinho vencida é liberada pela rotina ou reaproveitada
atomicamente por outra pessoa. Pedido vencido só libera os números depois de
consultar/cancelar a cobrança no gateway; pago perto do prazo é confirmado;
gateway fora do ar → números continuam reservados. Pagamento que chega depois
recupera os mesmos números só se ainda estiverem livres; caso contrário vira
pendência de devolução.
Evidência: `int/reservations` (expiração, 3 testes); `int/payments` "pago
perto do fim do prazo…", "gateway fora do ar na expiração…", "webhook
atrasado depois da expiração…", "pagamento após expiração com número já
vendido a outro: nunca toma o número"; `int/orders` "expira pedido manual
vencido…".

**Uma compra múltipla pode duplicar números? — Não.**
A seleção é normalizada (sem repetição), a reserva é tudo-ou-nada e cada
número tem uma linha única por campanha; o total é recalculado no servidor
(`quantidade × preço do banco`), com CHECK no banco.
Evidência: `int/reservations` "é tudo ou nada…", "trocar a seleção libera a
reserva anterior na mesma transação"; `int/orders` "é idempotente…",
"cliques duplos simultâneos criam um único pedido"; `unit/money`.

## Pix

**Um pagamento pode ser registrado duas vezes? — Não.**
`UNIQUE(gateway, gateway_payment_id)`, `UNIQUE(idempotency_key)` e
`UNIQUE(dedupe_key)` nos eventos; aplicação idempotente com o pedido travado;
cobrança criada sempre com a mesma `X-Idempotency-Key`.
Evidência: `int/payments` "repetir a criação (inclusive em paralelo) não cria
duas cobranças", "… reenviado 5 vezes → nenhuma duplicação", "mesma
notificação entregue 5 vezes em paralelo…", "pagamento duplicado … é
sinalizado, sem efeito duplo"; `int/admin` "… repetir não duplica".

**Um pagamento pode ser perdido? — Não, dentro do que o sistema controla.**
Webhook com falha responde 5xx para o gateway reenviar; conciliação a cada
60 s consulta pedidos pendentes e cobranças sem id (busca por referência); a
página do pedido também consulta; a expiração consulta antes de liberar.
Pagamento sem pedido correspondente (ex.: após restaurar um backup antigo) é
registrado em log para tratamento manual (docs/BACKUP.md).
Evidência: `int/payments` "OBRIGATÓRIO: aprovado no gateway, webhook NÃO chega
→ conciliação confirma o pedido", "gateway fora do ar ao receber webhook →
500 (reenvio) e a conciliação confirma depois", "queda entre criar a cobrança
e salvar o id…", "frontend sem atualização…".

**Um webhook duplicado é tratado? — Sim.** Ver acima (5× em série e em
paralelo, processado uma vez).

**Um webhook falso é rejeitado? — Sim.**
Assinatura HMAC-SHA256 obrigatória (comparação em tempo constante); mesmo
com assinatura válida, o sistema consulta o pagamento na API do gateway.
Evidência: `int/payments` "webhook com assinatura inválida ou ausente é
rejeitado (401) sem efeito", "rota HTTP /api/webhooks/pix valida assinatura e
confirma", "pagamento de outra origem (referência desconhecida) é ignorado".

**Um pagamento com valor errado é rejeitado? — Sim.**
Exige valor **exato**; diferente → `PAYMENT_AMOUNT_MISMATCH` e pendência
administrativa. Na confirmação manual, valor menor que o total é recusado e
registrado.
Evidência: `int/payments` "webhook com R$ 4,90 para pedido de R$ 49,00 NÃO
confirma", "pagamento parcial (R$ 24,50 de R$ 49,00) não confirma";
`int/admin` "exige marcação de verificação, valor ≥ total…".

**A conciliação recupera webhook perdido? — Sim.** Teste obrigatório do item
50: `int/payments` "OBRIGATÓRIO: aprovado no gateway, webhook NÃO chega →
conciliação confirma o pedido". A rotina também foi executada no container
`tools` (worker) do Docker.

## Segurança

**Um usuário consegue acessar o painel? — Só autenticado e com o papel
certo.** Sem sessão: páginas redirecionam para o login e a API responde 401;
token forjado não autentica; usuário desativado perde a sessão na hora.
Evidência: `int/admin` "sem sessão: 401…", "token inválido/forjado…",
"usuário desativado perde a sessão imediatamente", bloqueio após 5 senhas
erradas; `e2e/admin` (login recusado; `/admin/pedidos` sem sessão → login);
build de produção: `/admin` sem sessão → 307 para o login.

**OPERATOR consegue executar ação exclusiva de ADMIN? — Não.**
RBAC verificado no servidor em cada rota/página; tentativa gera log
`SECURITY`.
Evidência: `int/admin` "OPERADOR não acessa funções de administrador…" (status,
configurações da campanha, criação de usuário, exportação — 403 e 4 logs),
"SOMENTE LEITURA não confirma pagamento…"; `e2e/admin` (leitor recebe "Sem
permissão" em auditoria, `/status` e usuários).

**O preço pode ser manipulado pelo navegador? — Não.**
Schemas estritos recusam campos como `priceCents`, `status`, `totalCents`;
preço vem do banco; alteração de preço com vendas exige confirmação, motivo e
auditoria, e não altera pedidos existentes.
Evidência: `int/orders` "converte a reserva em pedido com preço oficial do
banco", "recalcula com o preço vigente no banco…"; `int/admin` "pedido criado
pelo painel ignora qualquer preço enviado…", "alterar o preço com pedidos
existentes exige confirmação…", "confirmação … campos extras são recusados";
`unit/format` "rejeita … campos extras (ex.: preço)"; `e2e/public` (API
recusa `priceCents` com 400).

**Dados pessoais ficam expostos? — Não.**
Páginas públicas e resultado não mostram CPF, telefone, e-mail ou nome
completo; consulta exige código + WhatsApp com resposta idêntica para
qualquer erro; VIEWER vê dados mascarados; logs com redação de PII.
Evidência: `int/orders` "visão pública não expõe telefone, e-mail nem nome
completo", "consulta exige código E WhatsApp corretos…"; `int/admin` (VIEWER
mascarado); `e2e/public` "consulta…" (página do pedido sem o telefone);
`e2e/draw` (resultado sem nomes dos compradores).

## Sorteio

**Somente números elegíveis entram? — Sim.** O snapshot é exatamente a lista
de números `PAID` no congelamento (o trigger compara com o banco); o
congelamento exige nenhum número reservado/pendente, nenhum pedido pendente e
nenhuma pendência de pagamento; o resultado só aceita número do snapshot que
pertença a pedido pago.
Evidência: `int/draw` "bloqueia com vendas abertas e com pedidos aguardando
pagamento", "pagamento de pedido expirado confirmado após o congelamento não
entra na lista", "CSPRNG: vencedores sempre na lista elegível…".

**A lista é congelada? — Sim.** Campanha `FROZEN`: nenhuma reserva, venda,
mudança de preço, de prêmios ou de números.
Evidência: `int/draw` "depois de congelar: sem novas reservas, sem mudança de
preço, prêmios ou snapshot".

**Existe snapshot? — Sim.** `draw_snapshots` com lista ordenada, quantidade,
hash, formato canônico, método, regra, referência oficial e data/hora;
imutável (UPDATE/DELETE recusados pelo banco).

**Existe hash? — Sim.** SHA-256 da lista canônica, calculado na aplicação e
**conferido pelo próprio banco** na inserção; recalculado na homologação;
publicado com a lista para download.
Evidência: `int/draw` "congela, publica lista canônica com SHA-256 idêntico ao
do banco…"; `unit/draw-methods` (formato canônico); `e2e/draw` (o SHA-256 do
arquivo baixado confere com o publicado).

**O resultado fica registrado? — Sim.** Por prêmio: entrada oficial, número
derivado, vencedor, passo a passo, pedido; auditoria `DRAW_EXECUTED`/
`DRAW_FINALIZED`; relatório JSON e para impressão.
Evidência: `int/draw` "homologa: …" (trilha de auditoria completa no
relatório).

**O administrador consegue alterar o vencedor depois? — Não.** Não existe
campo para vencedor; execução única com trava (5 execuções simultâneas → 1);
`draw_results` e resultado do snapshot imutáveis no banco; campanha `DRAWN`
nunca volta a `ACTIVE`; anulação só antes da homologação, pública, e proibida
para CSPRNG já executado.
Evidência: `int/draw` "Loteria Federal: … execução única" (UPDATE/DELETE
diretos recusados), "homologa: … nada volta a ACTIVE", "CSPRNG: … apuração
executada não pode ser anulada", "anulação (erro de digitação…)".

---

Nenhuma resposta indica vulnerabilidade. Pontos que dependem de ação humana
ou de ambiente estão em [SEGURANCA.md](SEGURANCA.md#4-riscos-residuais-e-recomendações).
