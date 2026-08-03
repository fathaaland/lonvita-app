#!/usr/bin/env bash
# Dumps the docker-compose Postgres service to a gzipped SQL file on the host.
# Runs pg_dump inside the container (via docker compose exec) so it works without
# any Postgres client tools installed on the host — only Docker is required.
set -euo pipefail

OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$OUT_DIR/lonvita-$STAMP.sql.gz"

docker compose exec -T postgres pg_dump -U payload -d lonvita | gzip > "$OUT_FILE"
echo "Backup written to $OUT_FILE"
