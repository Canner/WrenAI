-- Wave 3 non-breaking backfill before removing kb_snapshot.legacy_project_id
-- Keep this in sync with:
-- wren-ui/migrations/20260409153000_backfill_dashboard_and_kb_snapshot_runtime_binding.js

WITH ranked_deployments AS (
  SELECT
    dl.id,
    dl.project_id,
    dl.hash,
    dl.deploy_hash,
    dl.workspace_id,
    dl.knowledge_base_id,
    dl.kb_snapshot_id,
    dl.status,
    dl.created_at,
    dl.updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY dl.kb_snapshot_id
      ORDER BY
        CASE WHEN dl.status = 'SUCCESS' THEN 0 ELSE 1 END,
        COALESCE(dl.updated_at, dl.created_at) DESC,
        dl.id DESC
    ) AS row_number
  FROM deploy_log AS dl
  WHERE dl.kb_snapshot_id IS NOT NULL
),
canonical_deployments AS (
  SELECT *
  FROM ranked_deployments
  WHERE row_number = 1
)
UPDATE kb_snapshot AS ks
SET deploy_hash = COALESCE(cd.hash, cd.deploy_hash, ks.deploy_hash)
FROM canonical_deployments AS cd
WHERE cd.kb_snapshot_id = ks.id
  AND COALESCE(cd.hash, cd.deploy_hash) IS NOT NULL
  AND ks.deploy_hash IS DISTINCT FROM COALESCE(cd.hash, cd.deploy_hash);

WITH ranked_deployments AS (
  SELECT
    dl.id,
    dl.project_id,
    dl.hash,
    dl.deploy_hash,
    dl.workspace_id,
    dl.knowledge_base_id,
    dl.kb_snapshot_id,
    dl.status,
    dl.created_at,
    dl.updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY dl.kb_snapshot_id
      ORDER BY
        CASE WHEN dl.status = 'SUCCESS' THEN 0 ELSE 1 END,
        COALESCE(dl.updated_at, dl.created_at) DESC,
        dl.id DESC
    ) AS row_number
  FROM deploy_log AS dl
  WHERE dl.kb_snapshot_id IS NOT NULL
),
canonical_deployments AS (
  SELECT *
  FROM ranked_deployments
  WHERE row_number = 1
)
UPDATE dashboard AS d
SET
  project_id = COALESCE(d.project_id, cd.project_id, ks.legacy_project_id),
  knowledge_base_id = COALESCE(
    d.knowledge_base_id,
    cd.knowledge_base_id,
    ks.knowledge_base_id
  ),
  deploy_hash = COALESCE(
    cd.hash,
    cd.deploy_hash,
    d.deploy_hash,
    ks.deploy_hash
  )
FROM kb_snapshot AS ks
LEFT JOIN canonical_deployments AS cd ON cd.kb_snapshot_id = ks.id
WHERE d.kb_snapshot_id = ks.id
  AND (
    (d.project_id IS NULL AND COALESCE(cd.project_id, ks.legacy_project_id) IS NOT NULL)
    OR (d.knowledge_base_id IS NULL AND COALESCE(cd.knowledge_base_id, ks.knowledge_base_id) IS NOT NULL)
    OR (
      COALESCE(cd.hash, cd.deploy_hash) IS NOT NULL
      AND d.deploy_hash IS DISTINCT FROM COALESCE(cd.hash, cd.deploy_hash)
    )
  );
