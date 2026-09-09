#!/usr/bin/env bash
#
# Nightly Postgres backup for the SMM dashboard.
#
# The database holds accumulated daily snapshots that cannot be reconstructed:
# the platform APIs report today's follower count, never last month's. Losing the
# pgdata volume loses that history permanently, so this runs every night.
#
# Install and usage: docs/operations.md

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/smm-dashboard/app}"
BACKUP_DIR="${BACKUP_DIR:-/opt/smm-dashboard/backups}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
LOG="$BACKUP_DIR/backup.log"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"
}

stamp="$(date -u +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/smm-$stamp.dump"
tmp="$target.tmp"

# A dump is only renamed into place once it is complete and verified, so an
# interrupted run can never leave a truncated file that looks like a good backup.
trap 'rm -f "$tmp"' EXIT

log "starting backup -> $target"

# Credentials stay inside the container: nothing secret reaches the command line,
# the cron entry, or the process list on the host.
if ! docker compose -f "$COMPOSE_FILE" exec -T postgres \
    sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp"; then
  log "ERROR: pg_dump failed, no backup written"
  exit 1
fi

if [ ! -s "$tmp" ]; then
  log "ERROR: pg_dump produced an empty file, no backup written"
  exit 1
fi

# An unreadable dump is not a backup. pg_restore lives in the container, so the
# check does not require Postgres client tools on the host.
if ! docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore --list > /dev/null 2>&1 < "$tmp"; then
  log "ERROR: dump failed its pg_restore --list check, discarding it"
  exit 1
fi

mv "$tmp" "$target"
log "backup complete: $target ($(du -h "$target" | cut -f1))"

deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name 'smm-*.dump' -type f -mtime "+$RETENTION_DAYS" -print -delete | wc -l)"
if [ "$deleted" -gt 0 ]; then
  log "pruned $deleted backup(s) older than $RETENTION_DAYS days"
fi

log "kept $(find "$BACKUP_DIR" -maxdepth 1 -name 'smm-*.dump' -type f | wc -l) backup(s)"
