#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PG_URL="${1:-${PG_URL:-}}"
AUDIT_SQL="${ROOT_DIR}/misc/sql/runtime-scope-null-residual-audit.sql"
BACKFILL_SQL="${ROOT_DIR}/misc/sql/runtime-scope-null-residual-backfill.sql"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="${ROOT_DIR}/tmp/runtime-scope-backups"

if [[ -z "$PG_URL" ]]; then
  echo "usage: bash misc/scripts/runtime-scope-null-residual-backfill-apply.sh <postgres-connection-url>"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required"
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required"
  exit 1
fi

if [[ ! -f "$AUDIT_SQL" ]]; then
  echo "audit SQL file not found: $AUDIT_SQL"
  exit 1
fi

if [[ ! -f "$BACKFILL_SQL" ]]; then
  echo "backfill SQL file not found: $BACKFILL_SQL"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
BACKUP_PATH="${BACKUP_DIR}/runtime-scope-null-residual.${TIMESTAMP}.dump"
pg_dump "$PG_URL" --format=custom --file="$BACKUP_PATH" >/dev/null

echo "runtime-scope-null-residual-backfill-apply: pg-url=${PG_URL}"
echo "runtime-scope-null-residual-backfill-apply: backup=${BACKUP_PATH}"
echo "== before-backfill =="
psql "$PG_URL" -v ON_ERROR_STOP=1 -f "$AUDIT_SQL"

psql "$PG_URL" -v ON_ERROR_STOP=1 -f "$BACKFILL_SQL" >/dev/null

echo "== after-backfill =="
psql "$PG_URL" -v ON_ERROR_STOP=1 -f "$AUDIT_SQL"

echo "runtime-scope-null-residual-backfill-apply: pass"
echo "note: legacy_bridge_only_rows may still remain; those rows need manual runtime binding because project_id alone is not enough to infer workspace safely."
