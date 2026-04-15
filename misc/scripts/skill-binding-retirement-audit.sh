#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PG_URL="${1:-${PG_URL:-}}"
READINESS_SQL="${ROOT_DIR}/misc/sql/skill-binding-retirement-readiness.sql"

if [[ -z "$PG_URL" ]]; then
  echo "usage: bash misc/scripts/skill-binding-retirement-audit.sh <postgres-connection-url>"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required"
  exit 1
fi

if [[ ! -f "$READINESS_SQL" ]]; then
  echo "readiness SQL file not found: $READINESS_SQL"
  exit 1
fi

required_table_count="$(psql "$PG_URL" -v ON_ERROR_STOP=1 -Atqc "
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('skill_definition', 'skill_binding');
")"

if [[ "$required_table_count" != "2" ]]; then
  echo "target database is missing one of: skill_definition, skill_binding"
  exit 1
fi

required_skill_definition_column_count="$(psql "$PG_URL" -v ON_ERROR_STOP=1 -Atqc "
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'skill_definition'
    AND column_name IN (
      'migration_source_binding_id',
      'kb_suggestion_ids',
      'execution_mode',
      'is_enabled'
    );
")"

if [[ "$required_skill_definition_column_count" != "4" ]]; then
  echo "skill_definition is missing one of required columns: migration_source_binding_id, kb_suggestion_ids, execution_mode, is_enabled"
  exit 1
fi

echo "skill-binding-retirement-audit: pg-url=${PG_URL}"
psql "$PG_URL" -v ON_ERROR_STOP=1 -f "$READINESS_SQL"
