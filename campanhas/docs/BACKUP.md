# Backup, restauração e recuperação

Todo o estado do sistema (campanhas, números, pedidos, pagamentos, eventos,
auditoria, sorteio) está no **PostgreSQL**. A aplicação e o worker não guardam
estado em disco. Proteger o banco é proteger a operação.

## 1. Estratégia recomendada

| Camada | Como | Frequência |
|---|---|---|
| Backup lógico completo | `scripts/backup.sh` (`pg_dump` formato custom) | diário (e antes de cada migração ou do congelamento do sorteio) |
| Ponto no tempo (PITR) | banco gerenciado com PITR **ou** arquivamento de WAL (ex.: pgBackRest/WAL-G) | contínuo — recomendado durante as vendas |
| Cópia fora do servidor | enviar o `.dump` (cifrado) para outro provedor/armazenamento | a cada backup |
| Teste de restauração | `scripts/restore-check.sh` | mensal e antes do sorteio |

Durante as vendas, o dado mais valioso é o dos últimos minutos (pagamentos
recém-confirmados). Por isso, em produção, prefira PostgreSQL gerenciado com
PITR ou configure arquivamento de WAL; o dump diário é a segunda linha de
defesa.

## 2. Fazer um backup

```bash
DATABASE_URL=postgresql://usuario:senha@host:5432/campanhas \
BACKUP_DIR=/var/backups/campanhas RETENTION_DAYS=30 \
sh scripts/backup.sh
```

O script:

1. gera `campanhas-AAAAMMDDTHHMMSSZ.dump` com `pg_dump --format=custom`
   (inclui schema, dados, sequências, triggers e funções);
2. **valida** o arquivo lendo o índice (`pg_restore --list`) antes de
   considerá-lo pronto (arquivos incompletos ficam como `.partial`);
3. cifra com GPG se `BACKUP_GPG_RECIPIENT` estiver definido;
4. grava o checksum SHA-256 (`.sha256`);
5. apaga backups locais mais antigos que `RETENTION_DAYS`.

No Docker Compose (o diretório `./backups` está montado no container do banco):

```bash
docker compose exec db sh -c 'pg_dump -U campanhas -d campanhas --format=custom --compress=9 \
  --no-owner --no-privileges -f /backups/campanhas-$(date -u +%Y%m%dT%H%M%SZ).dump'
```

Agendamento diário (cron do servidor):

```
15 3 * * * cd /opt/campanhas && DATABASE_URL=... BACKUP_DIR=/var/backups/campanhas sh scripts/backup.sh >> /var/log/campanhas-backup.log 2>&1
```

Segurança dos backups: eles contêm dados pessoais (nome, WhatsApp, e-mail,
CPF criptografado). Guarde-os cifrados, com acesso restrito, e respeite o
mesmo prazo de retenção da política de privacidade.

## 3. Testar a restauração (sem tocar na produção)

```bash
ADMIN_DATABASE_URL=postgresql://usuario:senha@host:5432/postgres \
SOURCE_DATABASE_URL=$DATABASE_URL \
sh scripts/restore-check.sh /var/backups/campanhas/campanhas-....dump
```

Restaura em um banco temporário `campanhas_restore_check_*` e confere:

- checksum do arquivo;
- `cadeia_auditoria_integra=true` (a cadeia de hash da auditoria continua válida);
- migrações aplicadas;
- `numeros_pagos_sem_pedido_pago=0` e `numero_em_dois_pedidos_ativos=0`;
- `snapshots_com_hash_valido=true` (listas congeladas dos sorteios);
- totais (campanhas, números pagos, pedidos, pagamentos, auditoria) iguais aos
  da origem, quando `SOURCE_DATABASE_URL` é informado.

O banco temporário é apagado ao final (mesmo em caso de erro).

Resultado da última execução no ambiente de desenvolvimento:

```
campanhas-20260928T213538Z.dump: OK
campanhas=2 · numeros_pagos=14 · pedidos=10 pagos=6 · pagamentos_aprovados=6 · auditoria=21
cadeia_auditoria_integra=true · migracoes_aplicadas=4
numeros_pagos_sem_pedido_pago=0 · numero_em_dois_pedidos_ativos=0 · snapshots_com_hash_valido=true
== Totais idênticos aos da origem ==
```

## 4. Recuperação (restaurar de verdade)

1. **Pare a escrita**: pare `app` e `worker` (ou coloque a campanha em
   "Pausada" se o banco ainda responde). Anote a hora.
2. Faça um backup do estado atual, mesmo que danificado (pode ser útil para
   perícia).
3. Crie um banco novo e restaure:
   ```bash
   createdb -h HOST -U USUARIO campanhas_restaurado
   pg_restore --no-owner --no-privileges --exit-on-error \
     -d postgresql://USUARIO:SENHA@HOST:5432/campanhas_restaurado campanhas-....dump
   ```
   A restauração completa carrega os dados antes de recriar os triggers, por
   isso as proteções não bloqueiam a carga.
4. Rode `scripts/restore-check.sh` no arquivo (ou as consultas dele no banco
   restaurado).
5. Aponte `DATABASE_URL` para o banco restaurado e rode
   `npx prisma migrate deploy` (não deve haver pendências).
6. Suba `app` e `worker`. Em seguida, em `/status`, execute **Conciliar
   pagamentos agora** e **Expirar reservas**.
7. **Confira com o gateway o intervalo perdido** (entre o backup e o
   incidente): no painel do Mercado Pago, liste os pagamentos aprovados do
   período e compare com os pedidos. Pedidos criados depois do backup **não
   existem** no banco restaurado: um pagamento aprovado para um código de
   pedido inexistente aparece em **Sistema → Logs** como "Pagamento do gateway
   sem pedido correspondente" (evento `UNKNOWN_ORDER`); trate-o
   manualmente (devolver o valor ou registrar a compra pelo painel, com
   observação). Com PITR esse intervalo é de minutos; só com dump diário, de
   até 24 h.
8. Verifique a auditoria (**Auditoria → Verificar integridade**) e registre o
   incidente em observação/documento interno.

## 5. Migrações e backup

- Sempre faça backup imediatamente antes de `prisma migrate deploy` em
  produção.
- Migrações são somente "para frente". Para desfazer uma migração com
  problema, restaure o backup feito antes dela (seção 4) ou crie uma nova
  migração corretiva — nunca edite uma já aplicada.

## 6. Antes do sorteio

Faça um backup e um teste de restauração logo após o **congelamento**. O hash
da lista congelada também é publicado na página de resultado; qualquer cópia
(inclusive do público) permite provar que a lista usada não mudou.
