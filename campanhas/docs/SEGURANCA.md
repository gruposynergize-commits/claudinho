# Segurança

## 1. Controles implementados

| Ameaça | Controle | Onde |
|---|---|---|
| Manipulação de preço/status pelo navegador | schemas `strictObject` recusam campos desconhecidos; preço, total e status vêm sempre do banco | `src/server/validation/*`, `orders/create.ts` |
| Venda dupla / corrida | `UPDATE … WHERE status='AVAILABLE'` atômico, tudo-ou-nada; índice único parcial por número ativo; triggers de estado | `numbers/reservations.ts`, migração `integrity` |
| Pagamento falso | webhook com HMAC-SHA256 (`x-signature`) em tempo constante **e** consulta obrigatória à API do gateway | `payments/webhook.ts` |
| Pagamento duplicado | chaves únicas (`gateway_payment_id`, `idempotency_key`, `dedupe_key`), aplicação idempotente com travas | `payments/apply.ts` |
| SQL injection | Prisma e `$queryRaw` com template parametrizado; nenhum SQL concatenado (`*Unsafe` não é usado no código da aplicação) | todo `src/server` |
| XSS | React escapa tudo; sem `dangerouslySetInnerHTML`; CSP com nonce e `strict-dynamic`; URLs de imagem só `https://` | `src/proxy.ts` |
| CSRF | mutações do painel exigem `Origin` igual ao da aplicação; cookie `SameSite=Lax`; login também checa origem | `security/request.ts`, `auth/guard.ts` |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` | `proxy.ts`, `next.config.ts` |
| Sessão | token aleatório de 256 bits; banco guarda só o SHA-256; cookie `__Host-` HttpOnly/Secure/SameSite=Lax; 12 h absoluta, 2 h ociosa; revogação ao trocar senha/desativar | `auth/session.ts` |
| Senhas | scrypt (N=2^15, r=8, p=3), mínimo 12 caracteres e 3 tipos; bloqueio de 15 min após 5 erros; mensagem única (não revela e-mails); comparação com hash fictício para tempo constante | `auth/password.ts`, `auth/login.ts` |
| Autorização | RBAC ADMIN/OPERATOR/VIEWER verificado no servidor em cada rota e página; negações registradas como `SECURITY` | `auth/rbac.ts`, `auth/guard.ts` |
| Força bruta / abuso | rate limit no PostgreSQL (vale para várias instâncias): login (IP e e-mail), reservas, pedidos, consulta (IP e código), status do pedido, webhook, leituras públicas, ações do painel, troca de senha. Limites públicos folgados para IPs compartilhados por operadoras móveis (CGNAT) | `security/rate-limit.ts` |
| Retenção de números (bloquear a venda reservando tudo) | teto de números retidos ao mesmo tempo por IP e campanha (reservas + pedidos pendentes; padrão 300), serializado por trava transacional; tentativas registradas como `SECURITY`; reservas expiram | `numbers/reservations.ts` |
| IP forjado | `X-Forwarded-For` lido só na posição do proxy confiável (`TRUST_PROXY_HOPS`) | `security/request.ts` |
| Enumeração de pedidos | consulta exige código **e** WhatsApp, com a mesma mensagem para qualquer erro; página do pedido usa token HMAC de 256 bits (não sequencial), `no-store` e `no-referrer` | `orders/view.ts`, `orders/access.ts` |
| Vazamento de dados pessoais | página pública e resultado sem CPF/telefone/e-mail; VIEWER vê dados mascarados; logs com redação automática de PII e segredos | `campaigns/public.ts`, `logger.ts` |
| Segredos | só em variáveis de ambiente ou criptografados (AES-256-GCM) no banco; nunca retornados para a interface | `crypto.ts`, `payments/settings.ts` |
| Injeção em planilha | células CSV iniciadas por `= + - @` são neutralizadas | `admin/export.ts` |
| DoS por corpo grande | limites de tamanho em todas as entradas JSON; webhook recusa > 64 KB | `http.ts`, `api/webhooks/pix` |
| Adulteração do histórico | auditoria somente de inclusão com cadeia de hash; snapshot e resultado do sorteio imutáveis (triggers); verificação no painel | migração `integrity` |
| Sorteio manipulado | sem campo de vencedor; execução única com trava; hash publicado antes do resultado; CSPRNG não pode ser anulado depois de executado | `draw/service.ts`, migração `draw_annulment` |
| Erros | usuário vê mensagem amigável + código; detalhes técnicos só no log do servidor | `http.ts` |
| Transporte | HTTPS obrigatório em produção (com URL `http://` a aplicação recusa operar), HSTS com preload | `env.ts`, `next.config.ts` |
| Dependências | `npm audit`: 0 vulnerabilidades (overrides para dependências transitivas do Prisma CLI) | `package.json` |

## 2. Vulnerabilidades e falhas encontradas durante o desenvolvimento (e corrigidas)

| # | Encontrado | Risco | Correção | Verificação |
|---|---|---|---|---|
| 1 | `X-Forwarded-For` aceito como enviado pelo cliente | contornar rate limit forjando IP | só a entrada escrita pelo proxy confiável (`TRUST_PROXY_HOPS`) | teste de rate limit por e-mail com IPs variados; teste HTTP 30× mesmo IP → 429 |
| 2 | Deadlock (40P01) com webhooks simultâneos: `FOR UPDATE` × `FOR KEY SHARE` das FKs | webhook falhando sob carga | travas `FOR NO KEY UPDATE` em todo o código | 5 webhooks em paralelo processados uma vez, sem deadlock |
| 3 | Tentativa de confirmação manual com valor menor era desfeita junto com a transação | tentativa não ficava registrada | evento gravado fora da transação principal | `admin.test.ts` ("exige marcação…") |
| 4 | Webhook lia o corpo inteiro sem limite | consumo de memória | recusa > 64 KB antes de processar | revisão + limite no proxy (Caddy `max_size`) |
| 5 | Parâmetro `next` do login | redirecionamento para fora do site | aceita só caminhos internos do painel | revisão de código |
| 6 | Texto livre digitado no painel (referência do extrato) exportado em CSV | fórmula executada no Excel | neutralização de células perigosas | `admin.test.ts` (CSV com `=HYPERLINK`) |
| 7 | Troca da própria senha | sessão roubada trocando a senha | exige senha atual, limite próprio e encerra todas as sessões | `admin.test.ts` ("trocar a própria senha…") |
| 8 | `npm audit` com alertas altos em dependências do Prisma CLI | cadeia de suprimentos | overrides de versões corrigidas | `npm audit` = 0 |
| 9 | Datas sem horário interpretadas em UTC | início/fim de vendas um dia antes | datas = meio-dia de Brasília | teste de formatação/revisão |
| 10 | Caracteres Unicode invisíveis em código (U+2028 etc.) | regex/strings quebradas | substituídos por escapes | testes unitários de formatação |
| 11 | Estado inicial de componentes lido do navegador durante a renderização | divergência de hidratação | `useSyncExternalStore`/carregamento assíncrono | ESLint (regras do React Compiler) sem erros; E2E |
| 12 | Anulação de sorteio poderia virar "sortear de novo" | manipulação do vencedor | anulação só antes da homologação, com motivo público; bloqueada no banco para CSPRNG executado | `draw.test.ts` |
| 13 | Homologação confiava apenas no trigger de inserção do snapshot | alteração direta no banco passar despercebida | hash da lista recalculado na homologação | `draw.test.ts` |
| 14 | Nenhum limite para números retidos por cliente: um único IP podia manter a campanha inteira reservada (20 requisições × 100 números a cada 10 min) | negação de venda | teto de números retidos por IP, exato mesmo com requisições paralelas | `reservations.test.ts` (anti-retenção, 2 testes) |
| 15 | Limites por IP apertados para IPs compartilhados (CGNAT): ~10 compradores atrás do mesmo IP já esgotavam o limite de consulta de status | compradores reais bloqueados no pico | limites públicos revistos (reservas 60, pedidos 30, consultas 30 por 10 min; status 600/min) | revisão + E2E |

Nenhum item do checklist final ficou com resposta que indique vulnerabilidade
(ver [CHECKLIST.md](CHECKLIST.md)).

## 3. Verificações de produção executadas

- Build de produção (`next build`, saída standalone) servido atrás de proxy
  HTTPS: nenhuma violação de CSP no navegador em páginas públicas e do painel;
  cookie `__Host-campanhas_session` com `Secure`, `HttpOnly`, `SameSite=Lax`;
  HSTS, `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP
  presentes; requisição de outra origem com o cookie do admin → 403.
- Imagem Docker (`app`) construída e executada: páginas 200, painel sem
  sessão → redirecionado para o login, API do painel sem sessão → 401.
- 100 requisições HTTP simultâneas pelo mesmo número (IPs diferentes) → 1×201
  e 99×409 com mensagem amigável e sem stack trace.

## 4. Riscos residuais e recomendações

- **Contas do painel sem segundo fator.** Mitigado por senha forte, bloqueio,
  rate limit, expiração de sessão e auditoria. Recomendação: poucos ADMINs,
  senhas de gerenciador, e adicionar TOTP antes de escalar a operação.
- **Modo manual depende de conferência humana.** O sistema impede confirmação
  sem os campos obrigatórios e registra tudo, mas não lê o extrato. Prefira o
  modo automático.
- **Safari real não foi testado automaticamente** neste ambiente (os E2E
  rodam no Chromium com emulação de iPhone/Android). Rode
  `E2E_WEBKIT=1 npm run test:e2e` e teste em um iPhone antes de divulgar.
- **CSP permite `style` em atributos** (`style-src-attr 'unsafe-inline'`)
  para larguras dinâmicas de gráficos e barras; scripts inline continuam
  proibidos.
- **Limites por IP** não impedem ataques distribuídos (muitos IPs): o teto
  de retenção obriga o atacante a usar vários IPs, as reservas expiram e o
  painel permite liberar reservas e cancelar pedidos. Se houver abuso,
  adicione um desafio anti-robô (ex.: Turnstile) na reserva.
- **Link do pedido é um segredo**: quem tiver o link vê o pedido (primeiro
  nome, números, valor — sem telefone/e-mail/CPF).
- **Disponibilidade** depende de um único PostgreSQL: use serviço gerenciado
  com PITR (docs/BACKUP.md).
- **Conformidade legal** está fora do alcance do software: o sistema registra
  e exibe as informações, mas a autorização da operação é responsabilidade
  do organizador.
