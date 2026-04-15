#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PG_URL="${1:-${PG_URL:-}}"
BACKFILL_SQL="${ROOT_DIR}/misc/sql/project-identity-kb-snapshot-wave3-backfill.sql"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required"
  exit 1
fi

if [[ -z "$PG_URL" ]]; then
  echo "usage: bash misc/scripts/project-identity-kb-snapshot-backfill-rehearsal.sh <postgres-connection-url>"
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

echo "project-identity-wave3-backfill-rehearsal: pg-url=${PG_URL}"
echo "project-identity-wave3-backfill-rehearsal: mode=transactional-rollback"

psql "$PG_URL" -v ON_ERROR_STOP=1 <<SQL
\pset tuples_only on
\pset format unaligned
BEGIN;
SELECT '== before-backfill ==';
SELECT 'kb_snapshot_legacy_project_rows: ' || COUNT(*) FROM kb_snapshot WHERE legacy_project_id IS NOT NULL;
SELECT 'missing_canonical_deploy_rows: ' || COUNT(*) FROM kb_snapshot ks LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE ks.legacy_project_id IS NOT NULL AND dl.id IS NULL;
SELECT 'missing_deploy_hash_match_rows: ' || COUNT(*) FROM kb_snapshot ks LEFT JOIN deploy_log dl ON dl.hash = ks.deploy_hash WHERE ks.legacy_project_id IS NOT NULL AND dl.id IS NULL;
SELECT 'stale_kb_snapshot_deploy_hash_rows: ' || COUNT(*) FROM kb_snapshot ks JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE ks.legacy_project_id IS NOT NULL AND ks.deploy_hash IS NOT NULL AND dl.hash IS NOT NULL AND ks.deploy_hash <> dl.hash;
SELECT 'dashboards_needing_runtime_backfill: ' || COUNT(*) FROM dashboard d JOIN kb_snapshot ks ON ks.id = d.kb_snapshot_id LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE d.kb_snapshot_id IS NOT NULL AND ks.legacy_project_id IS NOT NULL AND ((d.project_id IS NULL AND COALESCE(dl.project_id, ks.legacy_project_id) IS NOT NULL) OR (COALESCE(dl.hash, dl.deploy_hash) IS NOT NULL AND d.deploy_hash IS NOT NULL AND d.deploy_hash <> COALESCE(dl.hash, dl.deploy_hash)));
\i ${BACKFILL_SQL}
SELECT '== after-backfill ==';
SELECT 'kb_snapshot_legacy_project_rows: ' || COUNT(*) FROM kb_snapshot WHERE legacy_project_id IS NOT NULL;
SELECT 'missing_canonical_deploy_rows: ' || COUNT(*) FROM kb_snapshot ks LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE ks.legacy_project_id IS NOT NULL AND dl.id IS NULL;
SELECT 'missing_deploy_hash_match_rows: ' || COUNT(*) FROM kb_snapshot ks LEFT JOIN deploy_log dl ON dl.hash = ks.deploy_hash WHERE ks.legacy_project_id IS NOT NULL AND dl.id IS NULL;
SELECT 'stale_kb_snapshot_deploy_hash_rows: ' || COUNT(*) FROM kb_snapshot ks JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE ks.legacy_project_id IS NOT NULL AND ks.deploy_hash IS NOT NULL AND dl.hash IS NOT NULL AND ks.deploy_hash <> dl.hash;
SELECT 'dashboards_needing_runtime_backfill: ' || COUNT(*) FROM dashboard d JOIN kb_snapshot ks ON ks.id = d.kb_snapshot_id LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id WHERE d.kb_snapshot_id IS NOT NULL AND ks.legacy_project_id IS NOT NULL AND ((d.project_id IS NULL AND COALESCE(dl.project_id, ks.legacy_project_id) IS NOT NULL) OR (COALESCE(dl.hash, dl.deploy_hash) IS NOT NULL AND d.deploy_hash IS NOT NULL AND d.deploy_hash <> COALESCE(dl.hash, dl.deploy_hash)));
DO \$\$
DECLARE
  remaining_stale_snapshot_hash_rows INTEGER;
  remaining_dashboards_needing_backfill INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO remaining_stale_snapshot_hash_rows
  FROM kb_snapshot ks
  JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id
  WHERE ks.legacy_project_id IS NOT NULL
    AND ks.deploy_hash IS NOT NULL
    AND dl.hash IS NOT NULL
    AND ks.deploy_hash <> dl.hash;

  SELECT COUNT(*)
  INTO remaining_dashboards_needing_backfill
  FROM dashboard d
  JOIN kb_snapshot ks ON ks.id = d.kb_snapshot_id
  LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id
  WHERE d.kb_snapshot_id IS NOT NULL
    AND ks.legacy_project_id IS NOT NULL
    AND (
      (d.project_id IS NULL AND COALESCE(dl.project_id, ks.legacy_project_id) IS NOT NULL)
      OR (
        COALESCE(dl.hash, dl.deploy_hash) IS NOT NULL
        AND d.deploy_hash IS NOT NULL
        AND d.deploy_hash <> COALESCE(dl.hash, dl.deploy_hash)
      )
    );

  IF remaining_stale_snapshot_hash_rows <> 0 OR remaining_dashboards_needing_backfill <> 0 THEN
    RAISE EXCEPTION 'project-identity-wave3-backfill-rehearsal: unresolved rows remain after rehearsal (stale=% dashboards=%)', remaining_stale_snapshot_hash_rows, remaining_dashboards_needing_backfill;
  END IF;
END
\$\$;
ROLLBACK;
SQL

echo "project-identity-wave3-backfill-rehearsal: pass"
