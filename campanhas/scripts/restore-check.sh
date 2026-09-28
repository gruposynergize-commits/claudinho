#!/usr/bin/env sh
# Teste de recuperação: restaura um backup em um banco TEMPORÁRIO, confere a
# integridade (checksum, cadeia de auditoria, invariantes, hashes dos
# sorteios) e apaga o banco temporário. Não toca no banco de produção.
#   ADMIN_DATABASE_URL=postgresql://usuario:senha@host:5432/postgres \
#     sh scripts/restore-check.sh backups/campanhas-AAAAMMDDTHHMMSSZ.dump
# Se SOURCE_DATABASE_URL for informado, os totais são comparados com a origem.
set -eu

FILE="${1:?informe o arquivo .dump}"
: "${ADMIN_DATABASE_URL:?informe ADMIN_DATABASE_URL (banco administrativo com permissão de CREATE DATABASE)}"

if [ -f "$FILE.sha256" ]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256")
fi

CHECK_DB="campanhas_restore_check_$(date -u +%Y%m%d%H%M%S)"
BASE="${ADMIN_DATABASE_URL%/*}"
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$CHECK_DB\""
trap 'psql "$ADMIN_DATABASE_URL" -q -c "DROP DATABASE IF EXISTS \"$CHECK_DB\"" >/dev/null 2>&1 || true' EXIT

pg_restore --no-owner --no-privileges --exit-on-error --dbname="$BASE/$CHECK_DB" "$FILE"

TOTALS="
SELECT 'campanhas=' || count(*) FROM campaigns;
SELECT 'numeros_pagos=' || count(*) FROM campaign_numbers WHERE status IN ('PAID','DRAWN','WINNER');
SELECT 'pedidos=' || count(*) || ' pagos=' || count(*) FILTER (WHERE status = 'PAID') FROM orders;
SELECT 'pagamentos_aprovados=' || count(*) FROM payments WHERE status = 'APPROVED';
SELECT 'auditoria=' || count(*) FROM audit_logs;
"
CHECKS="
SELECT 'cadeia_auditoria_integra=' || ok FROM verify_audit_chain();
SELECT 'migracoes_aplicadas=' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SELECT 'numeros_pagos_sem_pedido_pago=' || count(*) FROM campaign_numbers cn LEFT JOIN orders o ON o.id = cn.order_id
  WHERE cn.status IN ('PAID','DRAWN','WINNER') AND (o.id IS NULL OR o.status <> 'PAID');
SELECT 'numero_em_dois_pedidos_ativos=' || count(*) FROM (SELECT campaign_number_id FROM order_items WHERE active
  GROUP BY campaign_number_id HAVING count(*) > 1) x;
SELECT 'snapshots_com_hash_valido=' || coalesce(bool_and(eligible_numbers_hash = draw_canonical_hash(eligible_numbers, number_digits)), true)
  FROM draw_snapshots;
"

echo "== Banco restaurado ($CHECK_DB) =="
RESTORED=$(printf '%s' "$TOTALS" | psql "$BASE/$CHECK_DB" -v ON_ERROR_STOP=1 -At)
echo "$RESTORED"
printf '%s' "$CHECKS" | psql "$BASE/$CHECK_DB" -v ON_ERROR_STOP=1 -At

if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
  SOURCE=$(printf '%s' "$TOTALS" | psql "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -At)
  if [ "$SOURCE" = "$RESTORED" ]; then
    echo "== Totais idênticos aos da origem =="
  else
    echo "== ATENÇÃO: totais diferentes da origem (houve movimento depois do backup?) =="
    echo "$SOURCE"
  fi
fi
