-- Wave 3 read-only audit for removing kb_snapshot.legacy_project_id
-- Run against the real application database before dropping the final
-- compatibility mapping in kbSnapshotRepository/runtimeScope/dashboardRuntime.

-- 0) Sanity-check the target database before trusting the rest of this file.
-- If any regclass is NULL, you are not connected to the real app database yet.
SELECT
  to_regclass('public.kb_snapshot') AS kb_snapshot_table,
  to_regclass('public.dashboard') AS dashboard_table,
  to_regclass('public.deploy_log') AS deploy_log_table;

-- 1) How many snapshots still carry the old bridge project id?
SELECT COUNT(*) AS kb_snapshot_legacy_project_rows
FROM kb_snapshot
WHERE legacy_project_id IS NOT NULL;

-- 2) Inspect recent snapshots that still depend on the old column.
SELECT
  id,
  knowledge_base_id,
  deploy_hash,
  legacy_project_id,
  status,
  created_at,
  updated_at
FROM kb_snapshot
WHERE legacy_project_id IS NOT NULL
ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
LIMIT 50;

-- 3) Check whether every such snapshot already has canonical deploy_log linkage.
SELECT COUNT(*) AS missing_canonical_deploy_rows
FROM kb_snapshot ks
LEFT JOIN deploy_log dl
  ON dl.kb_snapshot_id = ks.id
WHERE ks.legacy_project_id IS NOT NULL
  AND dl.id IS NULL;

-- 4) Check whether deploy_hash lookup is still the only thing linking old snapshots.
SELECT COUNT(*) AS missing_deploy_hash_match_rows
FROM kb_snapshot ks
LEFT JOIN deploy_log dl
  ON dl.hash = ks.deploy_hash
WHERE ks.legacy_project_id IS NOT NULL
  AND dl.id IS NULL;

-- 5) Check snapshots whose stored deploy_hash drifts from the canonical
-- deployment linked by kb_snapshot_id.
SELECT COUNT(*) AS stale_kb_snapshot_deploy_hash_rows
FROM kb_snapshot ks
JOIN deploy_log dl
  ON dl.kb_snapshot_id = ks.id
WHERE ks.legacy_project_id IS NOT NULL
  AND ks.deploy_hash IS NOT NULL
  AND dl.hash IS NOT NULL
  AND ks.deploy_hash <> dl.hash;

-- 6) Inspect the snapshot deploy_hash drift rows before cutover.
SELECT
  ks.id,
  ks.knowledge_base_id,
  ks.deploy_hash AS kb_snapshot_deploy_hash,
  dl.hash AS canonical_deploy_hash,
  dl.status,
  dl.updated_at
FROM kb_snapshot ks
JOIN deploy_log dl
  ON dl.kb_snapshot_id = ks.id
WHERE ks.legacy_project_id IS NOT NULL
  AND ks.deploy_hash IS NOT NULL
  AND dl.hash IS NOT NULL
  AND ks.deploy_hash <> dl.hash
ORDER BY dl.updated_at DESC NULLS LAST, dl.created_at DESC NULLS LAST
LIMIT 50;

-- 7) Check dashboards that still need project / deploy_hash backfill from
-- canonical deployment data.
SELECT COUNT(*) AS dashboards_needing_runtime_backfill
FROM dashboard d
JOIN kb_snapshot ks ON ks.id = d.kb_snapshot_id
LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id
WHERE d.kb_snapshot_id IS NOT NULL
  AND ks.legacy_project_id IS NOT NULL;
  AND (
    (d.project_id IS NULL AND COALESCE(dl.project_id, ks.legacy_project_id) IS NOT NULL)
    OR (
      COALESCE(dl.hash, dl.deploy_hash) IS NOT NULL
      AND d.deploy_hash IS NOT NULL
      AND d.deploy_hash <> COALESCE(dl.hash, dl.deploy_hash)
    )
  );

-- 8) Inspect the dashboards above before cutover.
SELECT
  d.id,
  d.name,
  d.project_id,
  d.knowledge_base_id,
  d.kb_snapshot_id,
  d.deploy_hash AS dashboard_deploy_hash,
  ks.legacy_project_id,
  ks.deploy_hash AS kb_snapshot_deploy_hash,
  dl.project_id AS canonical_project_id,
  COALESCE(dl.hash, dl.deploy_hash) AS canonical_deploy_hash
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
  )
ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST
LIMIT 50;
