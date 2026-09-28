#!/usr/bin/env sh
# Backup lógico completo do PostgreSQL (formato custom, comprimido), validado
# e com checksum. Uso:
#   DATABASE_URL=postgresql://... BACKUP_DIR=./backups RETENTION_DAYS=30 sh scripts/backup.sh
# Opcional: BACKUP_GPG_RECIPIENT=<chave pública> para criptografar o arquivo.
set -eu

: "${DATABASE_URL:?defina DATABASE_URL}"
DIR="${BACKUP_DIR:-./backups}"
DAYS="${RETENTION_DAYS:-30}"
# libpq não aceita parâmetros específicos do Prisma (ex.: schema=).
URL=$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])(schema|connection_limit|pool_timeout)=[^&]*&?/\1/g; s/[?&]$//')

mkdir -p "$DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$DIR/campanhas-$TS.dump"

pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$FILE.partial" "$URL"
# O arquivo só é considerado pronto se o índice puder ser lido.
pg_restore --list "$FILE.partial" > /dev/null
mv "$FILE.partial" "$FILE"

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$FILE.gpg" "$FILE"
  rm -f "$FILE"
  FILE="$FILE.gpg"
fi
(cd "$DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256")

# Retenção: remove backups locais mais antigos que RETENTION_DAYS.
find "$DIR" -name 'campanhas-*.dump*' -type f -mtime +"$DAYS" -delete

echo "$FILE"
