-- Deterministic residual runtime-scope backfill.
--
-- This script intentionally avoids guessing from project_id alone.
-- It only fills NULL canonical scope fields when the row already carries
-- another trustworthy canonical anchor:
-- - thread_response / asking_task can inherit from parent rows
-- - knowledge_base_id can provide workspace_id
-- - knowledge_base_id + deploy_hash can provide kb_snapshot_id
-- - kb_snapshot_id can provide knowledge_base_id / deploy_hash / workspace_id

-- 1) Backfill thread_response directly from parent thread.
UPDATE thread_response AS tr
SET
  project_id = COALESCE(tr.project_id, t.project_id),
  workspace_id = COALESCE(tr.workspace_id, t.workspace_id),
  knowledge_base_id = COALESCE(tr.knowledge_base_id, t.knowledge_base_id),
  kb_snapshot_id = COALESCE(tr.kb_snapshot_id, t.kb_snapshot_id),
  deploy_hash = COALESCE(tr.deploy_hash, t.deploy_hash),
  actor_user_id = COALESCE(tr.actor_user_id, t.actor_user_id)
FROM thread AS t
WHERE tr.thread_id = t.id
  AND (
    (tr.project_id IS NULL AND t.project_id IS NOT NULL)
    OR (tr.workspace_id IS NULL AND t.workspace_id IS NOT NULL)
    OR (tr.knowledge_base_id IS NULL AND t.knowledge_base_id IS NOT NULL)
    OR (tr.kb_snapshot_id IS NULL AND t.kb_snapshot_id IS NOT NULL)
    OR (tr.deploy_hash IS NULL AND t.deploy_hash IS NOT NULL)
    OR (tr.actor_user_id IS NULL AND t.actor_user_id IS NOT NULL)
  );

-- 2) Backfill asking_task from thread_response / thread lineage.
WITH asking_task_sources AS (
  SELECT
    at.id,
    COALESCE(tr.project_id, t.project_id) AS project_id,
    COALESCE(tr.workspace_id, t.workspace_id) AS workspace_id,
    COALESCE(tr.knowledge_base_id, t.knowledge_base_id) AS knowledge_base_id,
    COALESCE(tr.kb_snapshot_id, t.kb_snapshot_id) AS kb_snapshot_id,
    COALESCE(tr.deploy_hash, t.deploy_hash) AS deploy_hash,
    COALESCE(tr.actor_user_id, t.actor_user_id) AS actor_user_id
  FROM asking_task AS at
  LEFT JOIN thread_response AS tr ON tr.id = at.thread_response_id
  LEFT JOIN thread AS t ON t.id = COALESCE(at.thread_id, tr.thread_id)
)
UPDATE asking_task AS at
SET
  project_id = COALESCE(at.project_id, src.project_id),
  workspace_id = COALESCE(at.workspace_id, src.workspace_id),
  knowledge_base_id = COALESCE(at.knowledge_base_id, src.knowledge_base_id),
  kb_snapshot_id = COALESCE(at.kb_snapshot_id, src.kb_snapshot_id),
  deploy_hash = COALESCE(at.deploy_hash, src.deploy_hash),
  actor_user_id = COALESCE(at.actor_user_id, src.actor_user_id)
FROM asking_task_sources AS src
WHERE at.id = src.id
  AND (
    (at.project_id IS NULL AND src.project_id IS NOT NULL)
    OR (at.workspace_id IS NULL AND src.workspace_id IS NOT NULL)
    OR (at.knowledge_base_id IS NULL AND src.knowledge_base_id IS NOT NULL)
    OR (at.kb_snapshot_id IS NULL AND src.kb_snapshot_id IS NOT NULL)
    OR (at.deploy_hash IS NULL AND src.deploy_hash IS NOT NULL)
    OR (at.actor_user_id IS NULL AND src.actor_user_id IS NOT NULL)
  );

-- 3) Generic deterministic backfill for the remaining runtime-scoped tables.
DO $$
DECLARE
  target_table TEXT;
  target_tables TEXT[] := ARRAY[
    'thread',
    'thread_response',
    'asking_task',
    'instruction',
    'sql_pair',
    'view',
    'model',
    'relation'
  ];
BEGIN
  FOREACH target_table IN ARRAY target_tables LOOP
    -- 3.1) If the row already knows knowledge_base_id + deploy_hash,
    -- backfill kb_snapshot_id from the canonical snapshot table.
    EXECUTE format(
      $sql$
      UPDATE %I AS target
      SET kb_snapshot_id = ks.id
      FROM kb_snapshot AS ks
      WHERE target.kb_snapshot_id IS NULL
        AND target.knowledge_base_id IS NOT NULL
        AND target.deploy_hash IS NOT NULL
        AND ks.knowledge_base_id = target.knowledge_base_id
        AND ks.deploy_hash = target.deploy_hash
      $sql$,
      target_table
    );

    -- 3.2) If the row knows kb_snapshot_id, fill the rest from kb_snapshot + knowledge_base.
    EXECUTE format(
      $sql$
      UPDATE %I AS target
      SET
        knowledge_base_id = COALESCE(target.knowledge_base_id, ks.knowledge_base_id),
        deploy_hash = COALESCE(target.deploy_hash, ks.deploy_hash),
        workspace_id = COALESCE(target.workspace_id, kb.workspace_id)
      FROM kb_snapshot AS ks
      JOIN knowledge_base AS kb ON kb.id = ks.knowledge_base_id
      WHERE target.kb_snapshot_id = ks.id
        AND (
          (target.knowledge_base_id IS NULL AND ks.knowledge_base_id IS NOT NULL)
          OR (target.deploy_hash IS NULL AND ks.deploy_hash IS NOT NULL)
          OR (target.workspace_id IS NULL AND kb.workspace_id IS NOT NULL)
        )
      $sql$,
      target_table
    );

    -- 3.3) If the row knows knowledge_base_id, fill workspace_id from knowledge_base.
    EXECUTE format(
      $sql$
      UPDATE %I AS target
      SET workspace_id = kb.workspace_id
      FROM knowledge_base AS kb
      WHERE target.knowledge_base_id = kb.id
        AND target.workspace_id IS NULL
        AND kb.workspace_id IS NOT NULL
      $sql$,
      target_table
    );
  END LOOP;
END
$$;
