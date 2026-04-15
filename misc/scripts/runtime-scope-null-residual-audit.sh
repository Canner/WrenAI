#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PG_URL="${1:-${PG_URL:-}}"
AUDIT_SQL="${ROOT_DIR}/misc/sql/runtime-scope-null-residual-audit.sql"

if [[ -z "$PG_URL" ]]; then
  echo "usage: bash misc/scripts/runtime-scope-null-residual-audit.sh <postgres-connection-url>"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required"
  exit 1
fi

if [[ ! -f "$AUDIT_SQL" ]]; then
  echo "audit SQL file not found: $AUDIT_SQL"
  exit 1
fi

required_table_count="$(psql "$PG_URL" -v ON_ERROR_STOP=1 -Atqc "
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'thread',
      'thread_response',
      'asking_task',
      'instruction',
      'sql_pair',
      'view',
      'model',
      'relation',
      'knowledge_base',
      'kb_snapshot'
    );
")"

if [[ "$required_table_count" != "10" ]]; then
  echo "target database is missing one of: thread, thread_response, asking_task, instruction, sql_pair, view, model, relation, knowledge_base, kb_snapshot"
  exit 1
fi

echo "runtime-scope-null-residual-audit: pg-url=${PG_URL}"
psql "$PG_URL" -v ON_ERROR_STOP=1 -f "$AUDIT_SQL"
