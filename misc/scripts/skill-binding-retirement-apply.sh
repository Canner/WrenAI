#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PG_URL="${1:-${PG_URL:-}}"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="${ROOT_DIR}/tmp/skill-binding-retirement-backups"
MIGRATION_FILE="20260410122000_drop_legacy_skill_binding.js"

if [[ -z "$PG_URL" ]]; then
  echo "usage: bash misc/scripts/skill-binding-retirement-apply.sh <postgres-connection-url>"
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

if ! command -v yarn >/dev/null 2>&1; then
  echo "yarn is required"
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/wren-ui/migrations/${MIGRATION_FILE}" ]]; then
  echo "migration file not found: wren-ui/migrations/${MIGRATION_FILE}"
  exit 1
fi

run_scalar_query() {
  local sql="$1"
  psql "$PG_URL" -v ON_ERROR_STOP=1 -Atqc "$sql"
}

required_table_count="$(run_scalar_query "
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('skill_definition', 'skill_binding');
")"

if [[ "$required_table_count" != "2" ]]; then
  echo "target database is missing one of: skill_definition, skill_binding"
  exit 1
fi

required_skill_definition_column_count="$(run_scalar_query "
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

duplicate_source_count() {
  run_scalar_query "
    SELECT COUNT(*)
    FROM (
      SELECT migration_source_binding_id
      FROM skill_definition
      WHERE migration_source_binding_id IS NOT NULL
      GROUP BY migration_source_binding_id
      HAVING COUNT(*) > 1
    ) AS duplicate_sources;
  "
}

incomplete_group_count() {
  run_scalar_query "
    WITH binding_groups AS (
      SELECT
        sb.skill_definition_id,
        COUNT(
          DISTINCT jsonb_build_object(
            'connectorId', sb.connector_id,
            'bindingConfig', sb.binding_config,
            'enabled', COALESCE(sb.enabled, true),
            'kbSnapshotId', sb.kb_snapshot_id
          )
        ) AS binding_group_count
      FROM skill_binding AS sb
      GROUP BY sb.skill_definition_id
    ),
    migrated_clones AS (
      SELECT
        sb.skill_definition_id,
        COUNT(DISTINCT sd.id) AS clone_count
      FROM skill_binding AS sb
      JOIN skill_definition AS sd
        ON sd.migration_source_binding_id = sb.id
       AND sd.id <> sb.skill_definition_id
      GROUP BY sb.skill_definition_id
    )
    SELECT COUNT(*)
    FROM binding_groups AS bg
    LEFT JOIN migrated_clones AS mc
      ON mc.skill_definition_id = bg.skill_definition_id
    WHERE bg.binding_group_count > 1
      AND COALESCE(mc.clone_count, 0) < bg.binding_group_count - 1;
  "
}

missing_runtime_settings_count() {
  run_scalar_query "
    SELECT COUNT(*)
    FROM skill_definition AS sd
    WHERE EXISTS (
      SELECT 1
      FROM skill_binding AS sb
      WHERE sb.skill_definition_id = sd.id
    )
      AND (
        sd.kb_suggestion_ids IS NULL
        OR sd.execution_mode IS NULL
        OR sd.is_enabled IS NULL
      );
  "
}

skill_binding_table_exists() {
  run_scalar_query "
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'skill_binding';
  "
}

print_gates() {
  echo "duplicate_migration_sources: $(duplicate_source_count)"
  echo "incomplete_binding_group_materializations: $(incomplete_group_count)"
  echo "missing_runtime_settings_on_legacy_skills: $(missing_runtime_settings_count)"
}

ensure_drop_gates() {
  local duplicate_count
  local incomplete_count
  local missing_settings_count

  duplicate_count="$(duplicate_source_count)"
  incomplete_count="$(incomplete_group_count)"
  missing_settings_count="$(missing_runtime_settings_count)"

  if [[ "$duplicate_count" != "0" || "$incomplete_count" != "0" || "$missing_settings_count" != "0" ]]; then
    echo "skill-binding-retirement-apply: readiness gates failed"
    echo "duplicate_migration_sources=${duplicate_count}"
    echo "incomplete_binding_group_materializations=${incomplete_count}"
    echo "missing_runtime_settings_on_legacy_skills=${missing_settings_count}"
    exit 1
  fi
}

mkdir -p "$BACKUP_DIR"
BACKUP_PATH="${BACKUP_DIR}/skill-binding-retirement.${TIMESTAMP}.dump"
pg_dump "$PG_URL" --format=custom --file="$BACKUP_PATH" >/dev/null

echo "skill-binding-retirement-apply: pg-url=${PG_URL}"
echo "skill-binding-retirement-apply: backup=${BACKUP_PATH}"

echo "== before-backfill-audit =="
bash misc/scripts/skill-binding-retirement-audit.sh "$PG_URL"
echo "== before-drop-gates =="
print_gates

pushd wren-ui >/dev/null
PG_URL="$PG_URL" yarn ts-node --compiler-options '{"module":"commonjs"}' scripts/migrate_skill_bindings_to_runtime_skills.ts --execute
popd >/dev/null

echo "== after-backfill-audit =="
bash misc/scripts/skill-binding-retirement-audit.sh "$PG_URL"
echo "== after-backfill-drop-gates =="
print_gates
ensure_drop_gates

pushd wren-ui >/dev/null
PG_URL="$PG_URL" yarn knex migrate:latest
popd >/dev/null

remaining_skill_binding_table_count="$(skill_binding_table_exists)"
if [[ "$remaining_skill_binding_table_count" != "0" ]]; then
  echo "skill-binding-retirement-apply: verification failed; skill_binding table still exists"
  exit 1
fi

echo "skill-binding-retirement-apply: pass"
echo "note: rollback requires restoring backup if legacy binding data must be recovered: ${BACKUP_PATH}"
