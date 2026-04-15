#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PG_URL="${1:-${PG_URL:-}}"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="${ROOT_DIR}/tmp/project-identity-backups"

if [[ -z "$PG_URL" ]]; then
  echo "usage: bash misc/scripts/project-identity-kb-snapshot-drop-legacy-column.sh <postgres-connection-url>"
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

required_table_count="$(psql "$PG_URL" -v ON_ERROR_STOP=1 -Atqc "
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('kb_snapshot', 'dashboard', 'deploy_log');
")"

if [[ "$required_table_count" != "3" ]]; then
  echo "target database is missing one of: kb_snapshot, dashboard, deploy_log"
  exit 1
fi

legacy_column_count="$(psql "$PG_URL" -v ON_ERROR_STOP=1 -Atqc "
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'kb_snapshot'
    AND column_name = 'legacy_project_id';
")"

if [[ "$legacy_column_count" == "0" ]]; then
  echo "project-identity-wave3-drop-legacy-column: already absent"
  psql "$PG_URL" -v ON_ERROR_STOP=1 -c "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'kb_snapshot' ORDER BY ordinal_position;"
  exit 0
fi

legacy_rows="$(psql "$PG_URL" -v ON_ERROR_STOP=1 -Atqc "
  SELECT COUNT(*)
  FROM kb_snapshot
  WHERE legacy_project_id IS NOT NULL;
")"

if [[ "$legacy_rows" != "0" ]]; then
  echo "refusing to drop kb_snapshot.legacy_project_id while ${legacy_rows} rows still carry legacy bridge data"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
BACKUP_PATH="${BACKUP_DIR}/project-identity-wave3-drop-legacy-column.${TIMESTAMP}.dump"
pg_dump "$PG_URL" --format=custom --file="$BACKUP_PATH" >/dev/null

echo "project-identity-wave3-drop-legacy-column: pg-url=${PG_URL}"
echo "project-identity-wave3-drop-legacy-column: backup=${BACKUP_PATH}"

psql "$PG_URL" -v ON_ERROR_STOP=1 -c "ALTER TABLE kb_snapshot DROP COLUMN legacy_project_id;" >/dev/null

remaining_column_count="$(psql "$PG_URL" -v ON_ERROR_STOP=1 -Atqc "
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'kb_snapshot'
    AND column_name = 'legacy_project_id';
")"

if [[ "$remaining_column_count" != "0" ]]; then
  echo "project-identity-wave3-drop-legacy-column: verification failed; column still exists"
  exit 1
fi

echo "project-identity-wave3-drop-legacy-column: pass"
psql "$PG_URL" -v ON_ERROR_STOP=1 -c "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'kb_snapshot' ORDER BY ordinal_position;"
