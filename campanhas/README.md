# Campanhas — gestão de campanhas de números (Campanha do Alek)

Sistema web para vender números de uma campanha, receber por Pix, confirmar
pagamentos automaticamente, administrar pedidos e realizar um sorteio
auditável. Configurado inicialmente para a **Campanha do Alek** (1.200 números,
0001–1200, R$ 4,90 cada, dois prêmios).

> **Conformidade.** Este software é uma ferramenta de gestão. Ele não torna
> uma campanha legal por si só: a operação precisa estar autorizada/enquadrada
> conforme a legislação aplicável, com regulamento próprio. As informações
> legais (responsável, entidade, CNPJ, autorização, regulamento, modalidade,
> método de apuração) são registradas no painel e exibidas na página pública.
> A campanha só pode ser ativada depois de preenchidas e de uma declaração
> explícita do administrador.

**Prioridade de projeto:** confiabilidade > segurança > consistência >
pagamento > sorteio > UX > estética. Regras críticas existem no serviço **e**
no PostgreSQL (constraints, índices únicos parciais e triggers): um bug na
aplicação não consegue gravar um estado inválido.

Documentação complementar:

| Documento | Conteúdo |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | decisões técnicas, modelo de dados, estados e fluxos |
| [docs/API.md](docs/API.md) | endpoints, autenticação, permissões e limites |
| [docs/GATEWAY-MERCADOPAGO.md](docs/GATEWAY-MERCADOPAGO.md) | contrato da API oficial usada, credenciais e webhook |
| [docs/OPERACAO.md](docs/OPERACAO.md) | rotina diária, atendimento, incidentes, dia do sorteio |
| [docs/BACKUP.md](docs/BACKUP.md) | backup, teste de restauração e recuperação |
| [docs/SEGURANCA.md](docs/SEGURANCA.md) | controles, vulnerabilidades encontradas e corrigidas, riscos residuais |
| [docs/CHECKLIST.md](docs/CHECKLIST.md) | checklist final respondido, com a evidência de cada item |

---

## 1. Instalação

Requisitos: **Node.js 22**, **PostgreSQL 14+** (testado no 16) e, para os
testes E2E, o Chromium do Playwright.

```bash
cd campanhas
npm ci
cp .env.example .env          # preencha (seção 2)
npm run db:migrate            # cria tabelas, constraints e triggers
npm run db:seed               # campanha do Alek (rascunho)
npm run create-admin -- --email=voce@exemplo.org --name="Seu Nome"
npm run dev                   # http://localhost:3000
```

Em outro terminal, para desenvolvimento com Pix automático, rode o simulador
do Mercado Pago (`npm run fake-gateway`, porta 4010) com
`MERCADOPAGO_API_BASE_URL=http://localhost:4010` no `.env`. **Nunca use o
simulador em produção.**

## 2. Configuração

Todas as variáveis estão comentadas em [`.env.example`](.env.example). O `.env`
**nunca** é versionado (está no `.gitignore`).

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | conexão PostgreSQL |
| `NEXT_PUBLIC_APP_URL` | sim | URL pública; **HTTPS obrigatório em produção** (com HTTP a aplicação recusa operar) |
| `AUTH_SECRET` | sim | ≥ 32 caracteres aleatórios (`openssl rand -base64 48`); HMAC de identificadores e derivação de chaves |
| `DATA_ENCRYPTION_KEY` | recomendada | 32 bytes em base64 para AES-256-GCM (CPF e credenciais salvas pelo painel) |
| `TRUST_PROXY_HOPS` | produção: `1` | quantos proxies confiáveis escrevem `X-Forwarded-For` (Caddy/Nginx/Vercel = 1) |
| `CRON_SECRET` | se usar cron externo | `Authorization: Bearer …` dos endpoints `/api/cron/*` |
| `MAX_HELD_NUMBERS_PER_IP` | não | anti-retenção: números retidos ao mesmo tempo por IP, por campanha (padrão 300) |
| `PAYMENT_GATEWAY` | modo automático | `mercadopago` |
| `PAYMENT_API_KEY` | modo automático | Access Token do Mercado Pago (somente backend) |
| `PAYMENT_WEBHOOK_SECRET` | modo automático | assinatura secreta dos webhooks |
| `MERCADOPAGO_API_BASE_URL` | não | padrão `https://api.mercadopago.com` (só muda para o simulador) |
| `MERCADOPAGO_PIX_MIN_EXPIRATION_MINUTES` | não | validade mínima da cobrança Pix (padrão 30) |
| `PAYMENT_WEBHOOK_URL` | não | URL do webhook, se diferente de `NEXT_PUBLIC_APP_URL/api/webhooks/pix` |
| `POSTGRES_PASSWORD`, `DOMAIN` | Docker Compose | senha do banco e domínio do HTTPS automático |

As credenciais do gateway também podem ser salvas em **Configurações →
Pagamentos** (ficam criptografadas no banco e nunca voltam para o navegador);
variáveis de ambiente têm precedência.

## 3. Banco de dados

PostgreSQL com transações, travas de linha e regras no próprio banco:

- `UNIQUE(campaign_id, number)`: número duplicado na campanha é impossível;
- índice único parcial em `order_items(campaign_number_id) WHERE active`: um
  número nunca está em dois pedidos ativos;
- `UNIQUE(gateway, gateway_payment_id)`, `UNIQUE(idempotency_key)`,
  `UNIQUE(dedupe_key)` em eventos: pagamento e webhook nunca duplicam;
- triggers de máquina de estados para números, pedidos, campanha e sorteio
  (`PAID → AVAILABLE` é rejeitado; `DRAWN` nunca volta a `ACTIVE`);
- auditoria somente de inclusão, encadeada por hash SHA-256 (verificável no
  painel); snapshot e resultado do sorteio imutáveis;
- dinheiro sempre em **centavos inteiros** (R$ 4,90 = 490).

Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## 4. Migrations

```bash
npm run db:migrate        # produção: prisma migrate deploy (só aplica o que falta)
npm run db:migrate:dev    # desenvolvimento: gera nova migração a partir do schema
```

- As regras de integridade (triggers, CHECKs, índices parciais) estão em
  `prisma/migrations/*_integrity` e `*_draw_annulment`, em SQL revisável.
- Nunca edite uma migração já aplicada; crie outra.
- Faça backup antes de migrar em produção (seção 10).

## 5. Seed

`npm run db:seed` é idempotente e cria, **sem nenhuma credencial**:

- campanha `alek` ("Campanha do Alek") em **rascunho**, 1.200 números
  (0001–1200), R$ 4,90, até 100 números por pedido, reserva de 10 min,
  pagamento em 30 min, prefixo `ALEK` (pedidos `ALEK-AAAAMMDD-000001`);
- prêmios: 1º Samsung Galaxy A05s usado; 2º Cesta de doces da Dmialo — com
  origem **"não informada"** (o sistema não presume doação);
- Pix no **modo manual** com a chave CPF `13786508917` e recebedor
  "A CONFIGURAR";
- FAQ e mensagem de confirmação para WhatsApp.

Usuários não são criados pelo seed. Use `npm run create-admin` (a senha vem de
`ADMIN_PASSWORD` ou é gerada e exibida uma única vez; nunca é argumento de
linha de comando).

Para abrir as vendas: preencha **Configurações → Informações legais**, confira
prêmios, recebedor/cidade do Pix e (se automático) o gateway; depois ative em
**Configurações → Campanha** com a declaração de conformidade.

## 6. Pix

Dois modos por campanha (**Configurações → Pagamentos**):

| | Automático (recomendado) | Manual (fallback) |
|---|---|---|
| Cobrança | individual por pedido, criada no gateway | BR Code estático com a chave `13786508917` e o valor do pedido |
| QR Code / copia e cola | sim (do gateway) | sim (gerado pelo sistema, CRC16 conferido) |
| Confirmação | webhook assinado + consulta à API + conciliação | **somente** por um operador após conferir o extrato |
| "Já paguei" | não existe | registra o aviso; o pedido continua `PENDING_PAYMENT` |

- A chave estática **nunca** confirma um pagamento sozinha: o sistema não tem
  como saber quem pagou.
- Comprovante, print ou "paguei" nunca confirmam compra.
- Confirmação manual exige a caixa "Verifiquei o pagamento na conta", o valor
  identificado (menor que o total é recusado e registrado), a referência do
  extrato e o motivo; gera AuditLog.
- A ferramenta "Pix estático — confirmação manual" (Configurações →
  Pagamentos) gera um QR avulso com a chave; ele não cria pedido e nunca é
  confirmado automaticamente.

## 7. Gateway

Mercado Pago, API de Pagamentos (`/v1/payments`), com contrato conferido no
SDK oficial. Suporta cobrança individual, identificação única
(`external_reference` = código do pedido), QR Code, copia e cola, webhook
assinado, consulta de status, busca por referência, cancelamento e
idempotência (`X-Idempotency-Key`). O modo automático exige e-mail do
comprador (campo obrigatório do gateway).

Passo a passo de credenciais, ambiente de testes e produção:
[docs/GATEWAY-MERCADOPAGO.md](docs/GATEWAY-MERCADOPAGO.md).

## 8. Webhook

- URL: `https://SEU-DOMINIO/api/webhooks/pix` (evento de pagamentos).
- Configure a mesma "assinatura secreta" do painel do Mercado Pago em
  `PAYMENT_WEBHOOK_SECRET`.
- Processamento: valida a assinatura `x-signature` (HMAC-SHA256, comparação
  em tempo constante) → deduplica o evento → **consulta o pagamento na API**
  (o corpo do webhook nunca é fonte de verdade) → confere referência, moeda e
  valor exato → confirma pedido e números em uma transação → registra evento.
- Respostas: `200` processado/já processado, `401` assinatura inválida (log de
  segurança), `5xx` falha temporária (o gateway reenvia; a conciliação também
  cobre), `413` corpo acima de 64 KB, `429` excesso de requisições.
- Webhook perdido: a rotina de conciliação (a cada 60 s) consulta pedidos
  pendentes no gateway e confirma os pagos.

## 9. Deploy

### Opção A — VPS com Docker Compose (PostgreSQL + app + worker + Caddy/HTTPS)

```bash
cp .env.example .env     # preencha, incluindo POSTGRES_PASSWORD e DOMAIN
docker compose up -d db
docker compose run --rm tools npx prisma migrate deploy
docker compose run --rm tools npm run db:seed
docker compose run --rm tools npm run create-admin -- --email=voce@exemplo.org --name="Seu Nome"
docker compose up -d     # app, worker e caddy (certificado HTTPS automático)
```

- `Dockerfile` com alvos `app` (servidor Next.js standalone, usuário sem
  privilégios, healthcheck) e `tools` (migrações, seed, admin, worker).
  Espelho da imagem base: `--build-arg NODE_IMAGE=...`.
- O Caddy termina o HTTPS e envia `X-Forwarded-For`; por isso
  `TRUST_PROXY_HOPS=1`.

### Opção B — Node + Nginx (ou outro proxy HTTPS)

```bash
npm ci && npm run build
cp -r .next/static .next/standalone/.next/static
npm run db:migrate
NODE_ENV=production PORT=3000 node .next/standalone/server.js   # atrás do proxy HTTPS
npm run worker                                                  # processo separado (systemd/pm2)
```

Sem processo contínuo (serverless), use um agendador chamando
`/api/cron/expire` (30–60 s), `/api/cron/reconcile` (60 s) e
`/api/cron/cleanup` (1 h) com `Authorization: Bearer $CRON_SECRET`.

### Verificação antes de abrir as vendas

- [ ] `npm run build` sem erros; migrações aplicadas (`prisma migrate deploy`)
- [ ] HTTPS ativo; `NEXT_PUBLIC_APP_URL` com `https://`; HSTS presente
- [ ] webhook público acessível e testado (um pagamento real de baixo valor)
- [ ] `/status` sem alertas: banco, gateway, webhook, rotinas rodando
- [ ] logs em **Sistema → Logs**; backup agendado e restauração testada

## 10. Backup

```bash
DATABASE_URL=... BACKUP_DIR=/backups RETENTION_DAYS=30 sh scripts/backup.sh
```

Dump completo (`pg_dump` formato custom), validado com `pg_restore --list`,
checksum SHA-256, criptografia opcional (GPG) e retenção. Agende diariamente,
copie para fora do servidor e mantenha cópias cifradas. Procedimento
completo e recomendações (PITR, frequência): [docs/BACKUP.md](docs/BACKUP.md).

## 11. Recuperação

Teste mensal (não toca na produção):

```bash
ADMIN_DATABASE_URL=postgresql://usuario:senha@host:5432/postgres \
SOURCE_DATABASE_URL=$DATABASE_URL sh scripts/restore-check.sh /backups/campanhas-....dump
```

Restaura em um banco temporário e confere checksum, cadeia de auditoria,
migrações, invariantes (número pago sem pedido pago, número em dois pedidos),
hashes dos sorteios e totais; depois apaga o banco temporário. Recuperação
real, passo a passo, e o que conferir com o gateway depois:
[docs/BACKUP.md](docs/BACKUP.md).

## 12. Administração

Painel em `/admin` (papéis: **ADMIN** acesso completo; **OPERATOR** vendas e
atendimento; **VIEWER** somente leitura, com dados pessoais mascarados).

- Dashboard com totais e gráficos (vendas e arrecadação por dia, evolução até
  1.200, situação dos números, pendentes por tempo de espera).
- Pedidos: filtros (nome, telefone, pedido, número, situação, período),
  detalhe, confirmar Pix manual, verificar no gateway, cancelar, corrigir
  dados (auditado), reenviar confirmação (WhatsApp), observações,
  reembolso; "Novo pedido" para reservar números em nome do comprador.
- Números (bloquear/desbloquear/liberar reserva, com motivo), compradores
  (exportação de dados do titular, correção, anonimização), pagamentos com
  pendência (valor divergente, duplicado, tardio).
- Configurações: campanha (alterações críticas com vendas exigem
  confirmação e motivo), prêmios, informações legais, pagamentos/Pix,
  usuários.
- Auditoria (com verificação da cadeia de hash), **Sistema → Logs**,
  `/status` (somente administradores), exportações CSV (números, compradores,
  pedidos, pagamentos, auditoria).

Rotina diária e tratamento de cada situação: [docs/OPERACAO.md](docs/OPERACAO.md).

## 13. Sorteio

Painel → **Sorteio** (somente ADMIN executa):

1. Encerrar as vendas.
2. **Congelar**: exige nenhum número reservado/aguardando, nenhum pedido
   pendente e nenhum pagamento com pendência. Grava a lista ordenada dos
   números pagos, a quantidade e o **SHA-256**, com o método e a referência
   oficial (ex.: extração da Loteria Federal, que precisa ser **futura**).
   A lista e o hash ficam públicos imediatamente.
3. **Apurar** uma única vez pelo método do regulamento: Loteria Federal
   (regra de derivação documentada), hash verificável (SHA-256 com amostragem
   por rejeição) ou `crypto.randomInt` (nunca `Math.random`). A entrada
   oficial é digitada duas vezes e pode ser conferida antes de gravar. **Não
   existe campo para digitar o vencedor.**
4. **Homologar**: o sistema reconfere o hash e a elegibilidade de cada
   vencedor; a campanha passa a "Sorteio realizado" e nunca volta a vender.
5. Registrar a **entrega** de cada prêmio (aguardando contato → contatado →
   entregue/falha), com observações.

Anulação só antes da homologação, com motivo público (nunca para CSPRNG já
executado). Página pública: `/campanha/alek/resultado` (somente números, sem
dados de compradores), com instruções para qualquer pessoa conferir o hash
(`sha256sum`). Relatório para impressão e JSON no painel.

## 14. Segurança

- Entradas validadas com schemas estritos (campos extras como preço/status são
  recusados); preço e total sempre recalculados no servidor.
- SQL somente parametrizado; React escapa saída; CSP com nonce, HSTS,
  `frame-ancestors 'none'`, `nosniff`; CSV com neutralização de fórmulas.
- Sessões opacas no banco, cookie `__Host-` HttpOnly/Secure/SameSite=Lax,
  expiração por inatividade; senhas com scrypt; bloqueio após tentativas.
- CSRF: mutações do painel exigem `Origin` da própria aplicação.
- Rate limit no PostgreSQL: login, reservas, pedidos, consulta, webhook,
  leituras públicas e ações do painel.
- LGPD: coleta mínima, CPF criptografado, nada de dados pessoais na página
  pública, consulta só com código + WhatsApp, anonimização e retenção.
- Segredos só no ambiente/backend; nenhuma chave vai para o navegador.

Detalhes, vulnerabilidades encontradas/corrigidas e riscos residuais:
[docs/SEGURANCA.md](docs/SEGURANCA.md).

---

## Testes

```bash
npm run typecheck && npm run lint
npm run test:unit          # dinheiro, BR Code/CRC16, formatação, métodos de sorteio
npm run test:integration   # PostgreSQL real (banco campanhas_test, recriado a cada execução)
npm run test:e2e           # Playwright: banco campanhas_e2e + simulador do gateway
```

Cobertura dos fluxos críticos (resumo — lista completa em
[docs/CHECKLIST.md](docs/CHECKLIST.md)):

- concorrência: 100 reservas simultâneas do mesmo número → 1 sucesso e 99
  recusas controladas (no serviço e via HTTP); conjuntos sobrepostos nunca
  compartilham número; 50 fluxos completos simultâneos → 1 pedido;
- pagamento: pedido de R$ 49,00 pago → `PAID`; webhook repetido 5× (em série e
  em paralelo) processado uma vez; R$ 4,90 → não confirma
  (`PAYMENT_AMOUNT_MISMATCH`); assinatura inválida/ausente → 401; gateway fora
  do ar; **webhook perdido recuperado pela conciliação**; pagamento tardio,
  duplicado, parcial, cobrança expirada, reembolso;
- segurança: acesso sem sessão, OPERATOR/VIEWER em funções de ADMIN, CSRF,
  bloqueio de login, manipulação de preço/status, mascaramento de dados;
- sorteio: congelamento, snapshot, hash idêntico ao do banco, elegibilidade,
  execução única com 5 tentativas simultâneas, imutabilidade, anulação,
  homologação, entrega;
- E2E em iPhone e Android (emulação no Chromium): compra, Pix manual,
  consulta, confirmação pelo operador, Pix automático confirmado por
  webhook com a página atualizando sozinha, sorteio completo.

Safari real (WebKit): `E2E_WEBKIT=1 npm run test:e2e` após
`npx playwright install webkit` (não executado no ambiente de
desenvolvimento deste projeto — teste também em um iPhone real antes de
divulgar).

## Estrutura

```
campanhas/
  prisma/            schema, migrações (SQL de integridade) e seed
  src/app/           páginas (públicas e /admin) e rotas de API
  src/server/        serviços de domínio (números, pedidos, pagamentos, sorteio,
                     auth, auditoria, LGPD, jobs) — toda a lógica crítica
  src/lib/           utilitários puros (dinheiro, BR Code, métodos de sorteio)
  src/components/    componentes de interface
  scripts/           worker, create-admin, backup, restore-check, simulador
  tests/             unitários, integração (PostgreSQL real) e E2E
  deploy/            Caddyfile
```
