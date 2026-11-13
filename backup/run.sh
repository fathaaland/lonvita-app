#!/usr/bin/env bash
# A copy of the production database outside Neon (whose own point-in-time restore covers only its
# plan's history window, and nothing if the project itself is lost). Runs as a Railway cron service
# (backup/Dockerfile), every night at 01:15 UTC:
#   1. pg_dump, encrypted (gpg, AES256) before it leaves the container, into a bucket of its own;
#   2. on Sundays (BACKUP_RESTORE_TEST), the newest dump is restored into an empty Postgres started
#      inside this container, and checked — a backup nobody has restored is a hope, not a backup.
# A failure goes to the platform team's Discord; every run checks in with a Sentry cron monitor, so a
# night with no run at all alerts too.
#
# After restoring production from one of these dumps, the accounts deleted since the dump are back —
# delete them again (GDPR čl. 17) from the write-once audit copy:
#   DATABASE_URI=<restored db> pnpm tsx scripts/replay-anonymizations.ts --since <dump's UTC day> [--apply]
#
# Decrypting a dump by hand:
#   aws s3 cp s3://$BUCKET/<key> - --endpoint-url $ENDPOINT | gpg --decrypt > restore.dump
#
# Variables (Railway service "db-backup"):
#   BACKUP_DATABASE_URL     production, direct host (not "-pooler"); the read-only lonvita_backup role
#                           (scripts/neon-roles.sql) where it exists
#   BACKUP_PASSPHRASE       long random passphrase — keep a copy outside Railway (password manager):
#                           without it every dump is unreadable
#   BACKUP_S3_BUCKET        bucket for the dumps (not the media bucket; lifecycle rule e.g. 90 days)
#   BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY / BACKUP_S3_REGION ("auto" on R2)
#   BACKUP_S3_ENDPOINT      S3 endpoint for non-AWS storage (R2: https://<account>.r2.cloudflarestorage.com)
#   SENTRY_DSN              optional — the cron monitor "lonvita-database-backup"
#   OPS_DISCORD_WEBHOOK_URL optional — where a failure is reported
#   BACKUP_RESTORE_TEST     sunday (default) | always | never
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is not set}"
: "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is not set}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is not set}"

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}"
# R2 and MinIO don't take every checksum header a recent aws-cli sends by default.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

BUCKET="$BACKUP_S3_BUCKET"
ENDPOINT=()
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT=(--endpoint-url "$BACKUP_S3_ENDPOINT")

STEP="start"
WORK="$(mktemp -d)"
PGDATA_TMP=""

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

# --- reporting ------------------------------------------------------------------------------------

sentry_checkin() {
  [ -n "${SENTRY_DSN:-}" ] || { log "SENTRY_DSN not set — no cron check-in"; return 0; }
  local key host project
  key=$(echo "$SENTRY_DSN" | sed -E 's#^https://([^@]+)@.*#\1#')
  host=$(echo "$SENTRY_DSN" | sed -E 's#^https://[^@]+@([^/]+)/.*#\1#')
  project=$(echo "$SENTRY_DSN" | sed -E 's#.*/([0-9]+)$#\1#')
  jq -n --arg status "$1" '{status: $status, environment: "production", monitor_config: {
        schedule: {type: "crontab", value: "15 1 * * *"}, timezone: "UTC",
        checkin_margin: 120, max_runtime: 60, failure_issue_threshold: 1, recovery_threshold: 1 }}' \
    | curl -fsS -X POST -H 'Content-Type: application/json' --data @- \
        "https://$host/api/$project/cron/lonvita-database-backup/$key/" >/dev/null \
    || log "Sentry check-in failed"
}

discord_alert() {
  [ -n "${OPS_DISCORD_WEBHOOK_URL:-}" ] || { log "OPS_DISCORD_WEBHOOK_URL not set — no alert"; return 0; }
  local which="Záloha databáze"
  [ "$STEP" = "restore-test" ] && which="Test obnovy zálohy"
  jq -n --arg which "$which" --arg step "$STEP" '{
      username: "Lonvita alerts",
      allowed_mentions: { parse: [] },
      content: "🚨 **Kritický alert**",
      embeds: [{ title: ($which + " selhala"), color: 14427686,
                 description: ("Hrozí ztráta dat — zkontrolovat log služby db-backup na Railway (krok: " + $step + ").") }]
    }' | curl -fsS -X POST -H 'Content-Type: application/json' --data @- "$OPS_DISCORD_WEBHOOK_URL" >/dev/null \
    || log "Discord alert failed"
}

finish() {
  local code=$?
  if [ -n "$PGDATA_TMP" ]; then pg_ctl -D "$PGDATA_TMP" -m immediate stop >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
  if [ "$code" -eq 0 ]; then
    sentry_checkin ok
    log "Done."
  else
    log "FAILED at step: $STEP (exit $code)"
    sentry_checkin error
    discord_alert
  fi
  exit "$code"
}
trap finish EXIT

# --- 1. backup ------------------------------------------------------------------------------------

STEP="backup"
key="postgres/$(date -u +%Y/%m)/lonvita-$(date -u +%Y%m%dT%H%M%SZ).dump.gpg"
log "Dumping to s3://$BUCKET/$key"
# Custom format (pg_restore can pick tables out of it), no owners/grants — restorable into any
# database. Streamed: the plain dump never touches the disk.
pg_dump --format=custom --no-owner --no-acl "$BACKUP_DATABASE_URL" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 3<<<"$BACKUP_PASSPHRASE" \
  | aws s3 cp - "s3://$BUCKET/$key" "${ENDPOINT[@]}" --expected-size 10000000000 --only-show-errors
size=$(aws s3api head-object --bucket "$BUCKET" --key "$key" "${ENDPOINT[@]}" --query ContentLength --output text)
log "Uploaded ($size bytes)"
# An empty or tiny file means pg_dump failed half-way — fail loudly instead of "backed up".
if [ "$size" -lt 10000 ]; then log "Backup suspiciously small ($size bytes)"; exit 1; fi

# --- 2. restore test ------------------------------------------------------------------------------

case "${BACKUP_RESTORE_TEST:-sunday}" in
  always) ;;
  never) exit 0 ;;
  *) [ "$(date -u +%u)" = "7" ] || exit 0 ;;
esac

STEP="restore-test"
read -r newest modified < <(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix postgres/ "${ENDPOINT[@]}" \
  --query 'sort_by(Contents, &LastModified)[-1].[Key, LastModified]' --output text)
if [ -z "$newest" ] || [ "$newest" = "None" ]; then log "No backup found"; exit 1; fi
log "Restoring $newest (uploaded $modified)"

aws s3 cp "s3://$BUCKET/$newest" - "${ENDPOINT[@]}" --only-show-errors \
  | gpg --batch --decrypt --passphrase-fd 3 3<<<"$BACKUP_PASSPHRASE" > "$WORK/restore.dump"

# A throwaway Postgres inside this container: no port, only a socket in its own directory.
PGDATA_TMP="$WORK/pgdata"
initdb -D "$PGDATA_TMP" -U restore --auth=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$PGDATA_TMP" -o "-c listen_addresses='' -k $WORK" -w start >/dev/null
createdb -h "$WORK" -U restore restore
pg_restore --no-owner --no-acl --exit-on-error -h "$WORK" -U restore -d restore "$WORK/restore.dump"
rm -f "$WORK/restore.dump"

q() { psql -h "$WORK" -U restore -d restore -tAc "$1"; }
log "Tables: $(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
users=$(q "SELECT count(*) FROM users")
events=$(q "SELECT count(*) FROM events")
migrations=$(q "SELECT count(*) FROM payload_migrations")
log "users=$users events=$events migrations=$migrations"
if [ "$users" -lt 1 ] || [ "$migrations" -lt 1 ]; then log "Restored database is empty"; exit 1; fi
# The app writes audit entries every night (data retention, the audit export) — a dump whose newest
# one is days old was taken from a stale or wrong database.
lag=$(q "SELECT coalesce(floor(extract(epoch FROM now() - max(created_at)) / 3600), 99999)::int FROM audit_log")
log "Newest audit-log entry in the dump: ${lag} h ago"
if [ "$lag" -gt 72 ]; then log "Newest audit-log entry in the dump is ${lag} h old"; exit 1; fi
