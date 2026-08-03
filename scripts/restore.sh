#!/usr/bin/env bash
# Restores a backup.sh dump into a NEW database inside the same docker-compose Postgres
# service — never touches the source database. Point of a restore drill is proving the
# dump is actually usable, not restoring in place.
set -euo pipefail

DUMP_FILE="${1:?Usage: restore.sh <dump-file.sql.gz> <target-db-name>}"
TARGET_DB="${2:?Usage: restore.sh <dump-file.sql.gz> <target-db-name>}"

docker compose exec -T postgres psql -U payload -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";"
docker compose exec -T postgres psql -U payload -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TARGET_DB\";"
gunzip -c "$DUMP_FILE" | docker compose exec -T postgres psql -U payload -d "$TARGET_DB" -v ON_ERROR_STOP=1 > /dev/null
echo "Restored into database '$TARGET_DB'."
