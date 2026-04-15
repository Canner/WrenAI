#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PG_URL="${1:-${PG_URL:-}}"
BACKFILL_SQL="${ROOT_DIR}/misc/sql/project-identity-kb-snapshot-wave3-backfill.sql"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="${ROOT_DIR}/tmp/project-identity-backups"

if [[ -z "$PG_URL" ]]; then
  echo "usage: bash misc/scripts/project-identity-kb-snapshot-backfill-apply.sh <postgres-connection-url>"
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

if [[ ! -f "$BACKFILL_SQL" ]]; then
  echo "backfill SQL file not found: $BACKFILL_SQL"
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

run_scalar_query() {
  local sql="$1"
  psql "$PG_URL" -v ON_ERROR_STOP=1 -Atqc "$sql"
}

print_audit_snapshot() {
  local label="$1"

  local legacy_rows
  local missing_canonical_rows
  local missing_hash_rows
  local stale_snapshot_hash_rows
  local dashboards_needing_backfill

  legacy_rows="$(run_scalar_query "SELECT COUNT(*) FROM kb_snapshot WHERE legacy_project_id IS NOT NULL;")"
  missing_canonical_rows="$(run_scalar_query "SELECT COUNT(*) FROM kb_snapshot ks LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE ks.legacy_project_id IS NOT NULL AND dl.id IS NULL;")"
  missing_hash_rows="$(run_scalar_query "SELECT COUNT(*) FROM kb_snapshot ks LEFT JOIN deploy_log dl ON dl.hash = ks.deploy_hash WHERE ks.legacy_project_id IS NOT NULL AND dl.id IS NULL;")"
  stale_snapshot_hash_rows="$(run_scalar_query "SELECT COUNT(*) FROM kb_snapshot ks JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE ks.legacy_project_id IS NOT NULL AND ks.deploy_hash IS NOT NULL AND dl.hash IS NOT NULL AND ks.deploy_hash <> dl.hash;")"
  dashboards_needing_backfill="$(run_scalar_query "SELECT COUNT(*) FROM dashboard d JOIN kb_snapshot ks ON ks.id = d.kb_snapshot_id LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE d.kb_snapshot_id IS NOT NULL AND ks.legacy_project_id IS NOT NULL AND ((d.project_id IS NULL AND COALESCE(dl.project_id, ks.legacy_project_id) IS NOT NULL) OR (COALESCE(dl.hash, dl.deploy_hash) IS NOT NULL AND d.deploy_hash IS NOT NULL AND d.deploy_hash <> COALESCE(dl.hash, dl.deploy_hash)));")"

  echo "== ${label} =="
  echo "kb_snapshot_legacy_project_rows: ${legacy_rows}"
  echo "missing_canonical_deploy_rows: ${missing_canonical_rows}"
  echo "missing_deploy_hash_match_rows: ${missing_hash_rows}"
  echo "stale_kb_snapshot_deploy_hash_rows: ${stale_snapshot_hash_rows}"
  echo "dashboards_needing_runtime_backfill: ${dashboards_needing_backfill}"
}

mkdir -p "$BACKUP_DIR"
BACKUP_PATH="${BACKUP_DIR}/project-identity-wave3-backfill.${TIMESTAMP}.dump"
pg_dump "$PG_URL" --format=custom --file="$BACKUP_PATH" >/dev/null

echo "project-identity-wave3-backfill-apply: pg-url=${PG_URL}"
echo "project-identity-wave3-backfill-apply: backup=${BACKUP_PATH}"

print_audit_snapshot "before-backfill"

psql "$PG_URL" -v ON_ERROR_STOP=1 -f "$BACKFILL_SQL" >/dev/null

print_audit_snapshot "after-backfill"

remaining_stale_snapshot_hash_rows="$(run_scalar_query "SELECT COUNT(*) FROM kb_snapshot ks JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE ks.legacy_project_id IS NOT NULL AND ks.deploy_hash IS NOT NULL AND dl.hash IS NOT NULL AND ks.deploy_hash <> dl.hash;")"
remaining_dashboards_needing_backfill="$(run_scalar_query "SELECT COUNT(*) FROM dashboard d JOIN kb_snapshot ks ON ks.id = d.kb_snapshot_id LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE d.kb_snapshot_id IS NOT NULL AND ks.legacy_project_id IS NOT NULL AND ((d.project_id IS NULL AND COALESCE(dl.project_id, ks.legacy_project_id) IS NOT NULL) OR (COALESCE(dl.hash, dl.deploy_hash) IS NOT NULL AND d.deploy_hash IS NOT NULL AND d.deploy_hash <> COALESCE(dl.hash, dl.deploy_hash)));")"

if [[ "$remaining_stale_snapshot_hash_rows" != "0" || "$remaining_dashboards_needing_backfill" != "0" ]]; then
  echo "project-identity-wave3-backfill-apply: unresolved rows remain; restore from backup if needed: ${BACKUP_PATH}"
  exit 1
fi

echo "project-identity-wave3-backfill-apply: pass"
echo "note: legacy_project_id rows may still exist; do not remove the final compatibility mapping until the full Wave 3 audit passes."
