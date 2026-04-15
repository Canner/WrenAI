-- Manual backfill for residual project-only rows after strict canonical runtime
-- scope matching has been enabled.
--
-- Use this only after an operator has confirmed that a given legacy
-- project_id-only cohort belongs to exactly one canonical runtime scope.
--
-- Required psql variables:
--   source_project_id
--   target_workspace_id
--   target_knowledge_base_id
--   target_kb_snapshot_id
--   target_deploy_hash
--
-- Touched tables:
--   model
--   relation
--
-- Safety properties:
-- - idempotent: only updates rows whose canonical runtime fields are all NULL
-- - guarded: validates knowledge_base / kb_snapshot / deploy_log mapping first
-- - narrow: only touches the requested source_project_id cohort

SELECT set_config(
  'wren.runtime_scope.source_project_id',
  :'source_project_id',
  false
);
SELECT set_config(
  'wren.runtime_scope.target_workspace_id',
  :'target_workspace_id',
  false
);
SELECT set_config(
  'wren.runtime_scope.target_knowledge_base_id',
  :'target_knowledge_base_id',
  false
);
SELECT set_config(
  'wren.runtime_scope.target_kb_snapshot_id',
  :'target_kb_snapshot_id',
  false
);
SELECT set_config(
  'wren.runtime_scope.target_deploy_hash',
  :'target_deploy_hash',
  false
);

DO $$
DECLARE
  v_source_project_id INTEGER := current_setting(
    'wren.runtime_scope.source_project_id'
  )::INTEGER;
  v_target_workspace_id TEXT := current_setting(
    'wren.runtime_scope.target_workspace_id'
  );
  v_target_knowledge_base_id TEXT := current_setting(
    'wren.runtime_scope.target_knowledge_base_id'
  );
  v_target_kb_snapshot_id TEXT := current_setting(
    'wren.runtime_scope.target_kb_snapshot_id'
  );
  v_target_deploy_hash TEXT := current_setting(
    'wren.runtime_scope.target_deploy_hash'
  );
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM knowledge_base
    WHERE id = v_target_knowledge_base_id
      AND workspace_id = v_target_workspace_id
  ) THEN
    RAISE EXCEPTION
      'knowledge_base % does not belong to workspace %',
      v_target_knowledge_base_id,
      v_target_workspace_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM kb_snapshot
    WHERE id = v_target_kb_snapshot_id
      AND knowledge_base_id = v_target_knowledge_base_id
      AND deploy_hash = v_target_deploy_hash
  ) THEN
    RAISE EXCEPTION
      'kb_snapshot % does not match knowledge_base % + deploy_hash %',
      v_target_kb_snapshot_id,
      v_target_knowledge_base_id,
      v_target_deploy_hash;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM deploy_log
    WHERE project_id = v_source_project_id
      AND hash = v_target_deploy_hash
  ) THEN
    RAISE EXCEPTION
      'deploy_log hash % does not exist for project_id %',
      v_target_deploy_hash,
      v_source_project_id;
  END IF;
END
$$;

WITH updated AS (
  UPDATE model
  SET workspace_id = :'target_workspace_id',
      knowledge_base_id = :'target_knowledge_base_id',
      kb_snapshot_id = :'target_kb_snapshot_id',
      deploy_hash = :'target_deploy_hash'
  WHERE project_id = CAST(:'source_project_id' AS INTEGER)
    AND workspace_id IS NULL
    AND knowledge_base_id IS NULL
    AND kb_snapshot_id IS NULL
    AND deploy_hash IS NULL
  RETURNING id
)
SELECT 'updated_model_rows=' || COUNT(*)
FROM updated;

WITH updated AS (
  UPDATE relation
  SET workspace_id = :'target_workspace_id',
      knowledge_base_id = :'target_knowledge_base_id',
      kb_snapshot_id = :'target_kb_snapshot_id',
      deploy_hash = :'target_deploy_hash'
  WHERE project_id = CAST(:'source_project_id' AS INTEGER)
    AND workspace_id IS NULL
    AND knowledge_base_id IS NULL
    AND kb_snapshot_id IS NULL
    AND deploy_hash IS NULL
  RETURNING id
)
SELECT 'updated_relation_rows=' || COUNT(*)
FROM updated;

DO $$
DECLARE
  v_source_project_id INTEGER := current_setting(
    'wren.runtime_scope.source_project_id'
  )::INTEGER;
  remaining_model_rows INTEGER;
  remaining_relation_rows INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO remaining_model_rows
  FROM model
  WHERE project_id = v_source_project_id
    AND workspace_id IS NULL
    AND knowledge_base_id IS NULL
    AND kb_snapshot_id IS NULL
    AND deploy_hash IS NULL;

  SELECT COUNT(*)
  INTO remaining_relation_rows
  FROM relation
  WHERE project_id = v_source_project_id
    AND workspace_id IS NULL
    AND knowledge_base_id IS NULL
    AND kb_snapshot_id IS NULL
    AND deploy_hash IS NULL;

  IF remaining_model_rows <> 0 OR remaining_relation_rows <> 0 THEN
    RAISE EXCEPTION
      'project-only residual rows remain after manual backfill (model=% relation=%)',
      remaining_model_rows,
      remaining_relation_rows;
  END IF;
END
$$;
