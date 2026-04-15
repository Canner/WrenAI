#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PG_URL="${1:-${PG_URL:-}}"
AUDIT_SQL="${ROOT_DIR}/misc/sql/runtime-scope-null-residual-audit.sql"
BACKFILL_SQL="${ROOT_DIR}/misc/sql/runtime-scope-null-residual-backfill.sql"

if [[ -z "$PG_URL" ]]; then
  echo "usage: bash misc/scripts/runtime-scope-null-residual-backfill-rehearsal.sh <postgres-connection-url>"
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

if [[ ! -f "$BACKFILL_SQL" ]]; then
  echo "backfill SQL file not found: $BACKFILL_SQL"
  exit 1
fi

echo "runtime-scope-null-residual-backfill-rehearsal: pg-url=${PG_URL}"
echo "runtime-scope-null-residual-backfill-rehearsal: mode=transactional-rollback"

psql "$PG_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
\echo '== before-backfill =='
\i ${AUDIT_SQL}
\echo '== applying-deterministic-backfill =='
\i ${BACKFILL_SQL}
\echo '== after-backfill =='
\i ${AUDIT_SQL}
ROLLBACK;
SQL

echo "runtime-scope-null-residual-backfill-rehearsal: pass"
