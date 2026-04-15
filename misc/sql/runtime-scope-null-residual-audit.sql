-- Read-only audit for residual rows that may become hidden after
-- runtime-scope queries switch from bridge-friendly matching to strict
-- canonical matching.
--
-- Focus tables:
--   thread, thread_response, asking_task,
--   instruction, sql_pair, view, model, relation
--
-- Interpretation:
-- - legacy_bridge_only_rows:
--     project_id is still present but every canonical runtime field is NULL.
--     These rows now require manual mapping before canonical-only reads can see them.
-- - missing_workspace_rows:
--     workspace isolation is incomplete.
-- - missing_knowledge_base_rows / missing_kb_snapshot_rows / missing_deploy_hash_rows:
--     conservative residual indicators; some rows may still be queryable at broader scopes,
--     but they should be audited before final bridge cleanup.

-- 0) Sanity-check the target database before trusting the rest of this file.
SELECT
  to_regclass('public.thread') AS thread_table,
  to_regclass('public.thread_response') AS thread_response_table,
  to_regclass('public.asking_task') AS asking_task_table,
  to_regclass('public.instruction') AS instruction_table,
  to_regclass('public.sql_pair') AS sql_pair_table,
  to_regclass('public.view') AS view_table,
  to_regclass('public.model') AS model_table,
  to_regclass('public.relation') AS relation_table,
  to_regclass('public.knowledge_base') AS knowledge_base_table,
  to_regclass('public.kb_snapshot') AS kb_snapshot_table;

-- 1) Summary counts per table.
WITH scope_summary AS (
  SELECT
    'thread'::text AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (
      WHERE project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
    ) AS legacy_bridge_only_rows,
    COUNT(*) FILTER (WHERE workspace_id IS NULL) AS missing_workspace_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NOT NULL
        AND knowledge_base_id IS NULL
    ) AS missing_knowledge_base_rows,
    COUNT(*) FILTER (
      WHERE knowledge_base_id IS NOT NULL
        AND kb_snapshot_id IS NULL
    ) AS missing_kb_snapshot_rows,
    COUNT(*) FILTER (
      WHERE kb_snapshot_id IS NOT NULL
        AND deploy_hash IS NULL
    ) AS missing_deploy_hash_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NULL
         OR knowledge_base_id IS NULL
         OR kb_snapshot_id IS NULL
         OR deploy_hash IS NULL
    ) AS incomplete_scope_rows
  FROM thread

  UNION ALL

  SELECT
    'thread_response'::text AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (
      WHERE project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
    ) AS legacy_bridge_only_rows,
    COUNT(*) FILTER (WHERE workspace_id IS NULL) AS missing_workspace_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NOT NULL
        AND knowledge_base_id IS NULL
    ) AS missing_knowledge_base_rows,
    COUNT(*) FILTER (
      WHERE knowledge_base_id IS NOT NULL
        AND kb_snapshot_id IS NULL
    ) AS missing_kb_snapshot_rows,
    COUNT(*) FILTER (
      WHERE kb_snapshot_id IS NOT NULL
        AND deploy_hash IS NULL
    ) AS missing_deploy_hash_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NULL
         OR knowledge_base_id IS NULL
         OR kb_snapshot_id IS NULL
         OR deploy_hash IS NULL
    ) AS incomplete_scope_rows
  FROM thread_response

  UNION ALL

  SELECT
    'asking_task'::text AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (
      WHERE project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
    ) AS legacy_bridge_only_rows,
    COUNT(*) FILTER (WHERE workspace_id IS NULL) AS missing_workspace_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NOT NULL
        AND knowledge_base_id IS NULL
    ) AS missing_knowledge_base_rows,
    COUNT(*) FILTER (
      WHERE knowledge_base_id IS NOT NULL
        AND kb_snapshot_id IS NULL
    ) AS missing_kb_snapshot_rows,
    COUNT(*) FILTER (
      WHERE kb_snapshot_id IS NOT NULL
        AND deploy_hash IS NULL
    ) AS missing_deploy_hash_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NULL
         OR knowledge_base_id IS NULL
         OR kb_snapshot_id IS NULL
         OR deploy_hash IS NULL
    ) AS incomplete_scope_rows
  FROM asking_task

  UNION ALL

  SELECT
    'instruction'::text AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (
      WHERE project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
    ) AS legacy_bridge_only_rows,
    COUNT(*) FILTER (WHERE workspace_id IS NULL) AS missing_workspace_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NOT NULL
        AND knowledge_base_id IS NULL
    ) AS missing_knowledge_base_rows,
    COUNT(*) FILTER (
      WHERE knowledge_base_id IS NOT NULL
        AND kb_snapshot_id IS NULL
    ) AS missing_kb_snapshot_rows,
    COUNT(*) FILTER (
      WHERE kb_snapshot_id IS NOT NULL
        AND deploy_hash IS NULL
    ) AS missing_deploy_hash_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NULL
         OR knowledge_base_id IS NULL
         OR kb_snapshot_id IS NULL
         OR deploy_hash IS NULL
    ) AS incomplete_scope_rows
  FROM instruction

  UNION ALL

  SELECT
    'sql_pair'::text AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (
      WHERE project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
    ) AS legacy_bridge_only_rows,
    COUNT(*) FILTER (WHERE workspace_id IS NULL) AS missing_workspace_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NOT NULL
        AND knowledge_base_id IS NULL
    ) AS missing_knowledge_base_rows,
    COUNT(*) FILTER (
      WHERE knowledge_base_id IS NOT NULL
        AND kb_snapshot_id IS NULL
    ) AS missing_kb_snapshot_rows,
    COUNT(*) FILTER (
      WHERE kb_snapshot_id IS NOT NULL
        AND deploy_hash IS NULL
    ) AS missing_deploy_hash_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NULL
         OR knowledge_base_id IS NULL
         OR kb_snapshot_id IS NULL
         OR deploy_hash IS NULL
    ) AS incomplete_scope_rows
  FROM sql_pair

  UNION ALL

  SELECT
    'view'::text AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (
      WHERE project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
    ) AS legacy_bridge_only_rows,
    COUNT(*) FILTER (WHERE workspace_id IS NULL) AS missing_workspace_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NOT NULL
        AND knowledge_base_id IS NULL
    ) AS missing_knowledge_base_rows,
    COUNT(*) FILTER (
      WHERE knowledge_base_id IS NOT NULL
        AND kb_snapshot_id IS NULL
    ) AS missing_kb_snapshot_rows,
    COUNT(*) FILTER (
      WHERE kb_snapshot_id IS NOT NULL
        AND deploy_hash IS NULL
    ) AS missing_deploy_hash_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NULL
         OR knowledge_base_id IS NULL
         OR kb_snapshot_id IS NULL
         OR deploy_hash IS NULL
    ) AS incomplete_scope_rows
  FROM "view"

  UNION ALL

  SELECT
    'model'::text AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (
      WHERE project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
    ) AS legacy_bridge_only_rows,
    COUNT(*) FILTER (WHERE workspace_id IS NULL) AS missing_workspace_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NOT NULL
        AND knowledge_base_id IS NULL
    ) AS missing_knowledge_base_rows,
    COUNT(*) FILTER (
      WHERE knowledge_base_id IS NOT NULL
        AND kb_snapshot_id IS NULL
    ) AS missing_kb_snapshot_rows,
    COUNT(*) FILTER (
      WHERE kb_snapshot_id IS NOT NULL
        AND deploy_hash IS NULL
    ) AS missing_deploy_hash_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NULL
         OR knowledge_base_id IS NULL
         OR kb_snapshot_id IS NULL
         OR deploy_hash IS NULL
    ) AS incomplete_scope_rows
  FROM model

  UNION ALL

  SELECT
    'relation'::text AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (
      WHERE project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
    ) AS legacy_bridge_only_rows,
    COUNT(*) FILTER (WHERE workspace_id IS NULL) AS missing_workspace_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NOT NULL
        AND knowledge_base_id IS NULL
    ) AS missing_knowledge_base_rows,
    COUNT(*) FILTER (
      WHERE knowledge_base_id IS NOT NULL
        AND kb_snapshot_id IS NULL
    ) AS missing_kb_snapshot_rows,
    COUNT(*) FILTER (
      WHERE kb_snapshot_id IS NOT NULL
        AND deploy_hash IS NULL
    ) AS missing_deploy_hash_rows,
    COUNT(*) FILTER (
      WHERE workspace_id IS NULL
         OR knowledge_base_id IS NULL
         OR kb_snapshot_id IS NULL
         OR deploy_hash IS NULL
    ) AS incomplete_scope_rows
  FROM relation
)
SELECT *
FROM scope_summary
ORDER BY
  legacy_bridge_only_rows DESC,
  missing_workspace_rows DESC,
  missing_knowledge_base_rows DESC,
  table_name;

-- 2) Count rows that the deterministic backfill SQL can improve safely.
WITH deterministic_candidates AS (
  SELECT
    'thread'::text AS table_name,
    COUNT(*) FILTER (
      WHERE
        (
          knowledge_base_id IS NOT NULL
          AND deploy_hash IS NOT NULL
          AND kb_snapshot_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            WHERE ks.knowledge_base_id = thread.knowledge_base_id
              AND ks.deploy_hash = thread.deploy_hash
          )
        )
        OR (
          kb_snapshot_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            JOIN knowledge_base kb ON kb.id = ks.knowledge_base_id
            WHERE ks.id = thread.kb_snapshot_id
              AND (
                thread.knowledge_base_id IS NULL
                OR thread.workspace_id IS NULL
                OR thread.deploy_hash IS NULL
              )
          )
        )
        OR (
          knowledge_base_id IS NOT NULL
          AND workspace_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM knowledge_base kb
            WHERE kb.id = thread.knowledge_base_id
          )
        )
    ) AS deterministic_backfill_candidate_rows
  FROM thread

  UNION ALL

  SELECT
    'thread_response'::text AS table_name,
    COUNT(*) FILTER (
      WHERE
        (
          thread_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM thread t
            WHERE t.id = thread_response.thread_id
              AND (
                (thread_response.project_id IS NULL AND t.project_id IS NOT NULL)
                OR (thread_response.workspace_id IS NULL AND t.workspace_id IS NOT NULL)
                OR (thread_response.knowledge_base_id IS NULL AND t.knowledge_base_id IS NOT NULL)
                OR (thread_response.kb_snapshot_id IS NULL AND t.kb_snapshot_id IS NOT NULL)
                OR (thread_response.deploy_hash IS NULL AND t.deploy_hash IS NOT NULL)
              )
          )
        )
        OR (
          knowledge_base_id IS NOT NULL
          AND deploy_hash IS NOT NULL
          AND kb_snapshot_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            WHERE ks.knowledge_base_id = thread_response.knowledge_base_id
              AND ks.deploy_hash = thread_response.deploy_hash
          )
        )
        OR (
          kb_snapshot_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            JOIN knowledge_base kb ON kb.id = ks.knowledge_base_id
            WHERE ks.id = thread_response.kb_snapshot_id
              AND (
                thread_response.knowledge_base_id IS NULL
                OR thread_response.workspace_id IS NULL
                OR thread_response.deploy_hash IS NULL
              )
          )
        )
        OR (
          knowledge_base_id IS NOT NULL
          AND workspace_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM knowledge_base kb
            WHERE kb.id = thread_response.knowledge_base_id
          )
        )
    ) AS deterministic_backfill_candidate_rows
  FROM thread_response

  UNION ALL

  SELECT
    'asking_task'::text AS table_name,
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1
        FROM asking_task at2
        LEFT JOIN thread_response tr ON tr.id = at2.thread_response_id
        LEFT JOIN thread t ON t.id = COALESCE(at2.thread_id, tr.thread_id)
        WHERE at2.id = asking_task.id
          AND (
            (asking_task.project_id IS NULL AND COALESCE(tr.project_id, t.project_id) IS NOT NULL)
            OR (asking_task.workspace_id IS NULL AND COALESCE(tr.workspace_id, t.workspace_id) IS NOT NULL)
            OR (asking_task.knowledge_base_id IS NULL AND COALESCE(tr.knowledge_base_id, t.knowledge_base_id) IS NOT NULL)
            OR (asking_task.kb_snapshot_id IS NULL AND COALESCE(tr.kb_snapshot_id, t.kb_snapshot_id) IS NOT NULL)
            OR (asking_task.deploy_hash IS NULL AND COALESCE(tr.deploy_hash, t.deploy_hash) IS NOT NULL)
          )
      )
      OR (
        knowledge_base_id IS NOT NULL
        AND deploy_hash IS NOT NULL
        AND kb_snapshot_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM kb_snapshot ks
          WHERE ks.knowledge_base_id = asking_task.knowledge_base_id
            AND ks.deploy_hash = asking_task.deploy_hash
        )
      )
      OR (
        kb_snapshot_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM kb_snapshot ks
          JOIN knowledge_base kb ON kb.id = ks.knowledge_base_id
          WHERE ks.id = asking_task.kb_snapshot_id
            AND (
              asking_task.knowledge_base_id IS NULL
              OR asking_task.workspace_id IS NULL
              OR asking_task.deploy_hash IS NULL
            )
        )
      )
      OR (
        knowledge_base_id IS NOT NULL
        AND workspace_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM knowledge_base kb
          WHERE kb.id = asking_task.knowledge_base_id
        )
      )
    ) AS deterministic_backfill_candidate_rows
  FROM asking_task

  UNION ALL

  SELECT
    'instruction'::text AS table_name,
    COUNT(*) FILTER (
      WHERE
        (
          knowledge_base_id IS NOT NULL
          AND deploy_hash IS NOT NULL
          AND kb_snapshot_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            WHERE ks.knowledge_base_id = instruction.knowledge_base_id
              AND ks.deploy_hash = instruction.deploy_hash
          )
        )
        OR (
          kb_snapshot_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            JOIN knowledge_base kb ON kb.id = ks.knowledge_base_id
            WHERE ks.id = instruction.kb_snapshot_id
              AND (
                instruction.knowledge_base_id IS NULL
                OR instruction.workspace_id IS NULL
                OR instruction.deploy_hash IS NULL
              )
          )
        )
        OR (
          knowledge_base_id IS NOT NULL
          AND workspace_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM knowledge_base kb
            WHERE kb.id = instruction.knowledge_base_id
          )
        )
    ) AS deterministic_backfill_candidate_rows
  FROM instruction

  UNION ALL

  SELECT
    'sql_pair'::text AS table_name,
    COUNT(*) FILTER (
      WHERE
        (
          knowledge_base_id IS NOT NULL
          AND deploy_hash IS NOT NULL
          AND kb_snapshot_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            WHERE ks.knowledge_base_id = sql_pair.knowledge_base_id
              AND ks.deploy_hash = sql_pair.deploy_hash
          )
        )
        OR (
          kb_snapshot_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            JOIN knowledge_base kb ON kb.id = ks.knowledge_base_id
            WHERE ks.id = sql_pair.kb_snapshot_id
              AND (
                sql_pair.knowledge_base_id IS NULL
                OR sql_pair.workspace_id IS NULL
                OR sql_pair.deploy_hash IS NULL
              )
          )
        )
        OR (
          knowledge_base_id IS NOT NULL
          AND workspace_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM knowledge_base kb
            WHERE kb.id = sql_pair.knowledge_base_id
          )
        )
    ) AS deterministic_backfill_candidate_rows
  FROM sql_pair

  UNION ALL

  SELECT
    'view'::text AS table_name,
    COUNT(*) FILTER (
      WHERE
        (
          knowledge_base_id IS NOT NULL
          AND deploy_hash IS NOT NULL
          AND kb_snapshot_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            WHERE ks.knowledge_base_id = "view".knowledge_base_id
              AND ks.deploy_hash = "view".deploy_hash
          )
        )
        OR (
          kb_snapshot_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            JOIN knowledge_base kb ON kb.id = ks.knowledge_base_id
            WHERE ks.id = "view".kb_snapshot_id
              AND (
                "view".knowledge_base_id IS NULL
                OR "view".workspace_id IS NULL
                OR "view".deploy_hash IS NULL
              )
          )
        )
        OR (
          knowledge_base_id IS NOT NULL
          AND workspace_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM knowledge_base kb
            WHERE kb.id = "view".knowledge_base_id
          )
        )
    ) AS deterministic_backfill_candidate_rows
  FROM "view"

  UNION ALL

  SELECT
    'model'::text AS table_name,
    COUNT(*) FILTER (
      WHERE
        (
          knowledge_base_id IS NOT NULL
          AND deploy_hash IS NOT NULL
          AND kb_snapshot_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            WHERE ks.knowledge_base_id = model.knowledge_base_id
              AND ks.deploy_hash = model.deploy_hash
          )
        )
        OR (
          kb_snapshot_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            JOIN knowledge_base kb ON kb.id = ks.knowledge_base_id
            WHERE ks.id = model.kb_snapshot_id
              AND (
                model.knowledge_base_id IS NULL
                OR model.workspace_id IS NULL
                OR model.deploy_hash IS NULL
              )
          )
        )
        OR (
          knowledge_base_id IS NOT NULL
          AND workspace_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM knowledge_base kb
            WHERE kb.id = model.knowledge_base_id
          )
        )
    ) AS deterministic_backfill_candidate_rows
  FROM model

  UNION ALL

  SELECT
    'relation'::text AS table_name,
    COUNT(*) FILTER (
      WHERE
        (
          knowledge_base_id IS NOT NULL
          AND deploy_hash IS NOT NULL
          AND kb_snapshot_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            WHERE ks.knowledge_base_id = relation.knowledge_base_id
              AND ks.deploy_hash = relation.deploy_hash
          )
        )
        OR (
          kb_snapshot_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM kb_snapshot ks
            JOIN knowledge_base kb ON kb.id = ks.knowledge_base_id
            WHERE ks.id = relation.kb_snapshot_id
              AND (
                relation.knowledge_base_id IS NULL
                OR relation.workspace_id IS NULL
                OR relation.deploy_hash IS NULL
              )
          )
        )
        OR (
          knowledge_base_id IS NOT NULL
          AND workspace_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM knowledge_base kb
            WHERE kb.id = relation.knowledge_base_id
          )
        )
    ) AS deterministic_backfill_candidate_rows
  FROM relation
)
SELECT *
FROM deterministic_candidates
ORDER BY deterministic_backfill_candidate_rows DESC, table_name;

-- 3) Sample affected rows for manual follow-up.
SELECT *
FROM (
  SELECT
    'thread'::text AS table_name,
    id::text AS row_id,
    CASE
      WHEN project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
        THEN 'legacy_bridge_only'
      WHEN workspace_id IS NULL THEN 'missing_workspace'
      WHEN knowledge_base_id IS NULL THEN 'missing_knowledge_base'
      WHEN kb_snapshot_id IS NULL THEN 'missing_kb_snapshot'
      WHEN deploy_hash IS NULL THEN 'missing_deploy_hash'
    END AS issue_type,
    project_id::text AS project_id,
    workspace_id,
    knowledge_base_id,
    kb_snapshot_id,
    deploy_hash
  FROM thread
  WHERE workspace_id IS NULL
     OR knowledge_base_id IS NULL
     OR kb_snapshot_id IS NULL
     OR deploy_hash IS NULL

  UNION ALL

  SELECT 'thread_response', id::text,
    CASE
      WHEN project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
        THEN 'legacy_bridge_only'
      WHEN workspace_id IS NULL THEN 'missing_workspace'
      WHEN knowledge_base_id IS NULL THEN 'missing_knowledge_base'
      WHEN kb_snapshot_id IS NULL THEN 'missing_kb_snapshot'
      WHEN deploy_hash IS NULL THEN 'missing_deploy_hash'
    END,
    project_id::text, workspace_id, knowledge_base_id, kb_snapshot_id, deploy_hash
  FROM thread_response
  WHERE workspace_id IS NULL
     OR knowledge_base_id IS NULL
     OR kb_snapshot_id IS NULL
     OR deploy_hash IS NULL

  UNION ALL

  SELECT 'asking_task', id::text,
    CASE
      WHEN project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
        THEN 'legacy_bridge_only'
      WHEN workspace_id IS NULL THEN 'missing_workspace'
      WHEN knowledge_base_id IS NULL THEN 'missing_knowledge_base'
      WHEN kb_snapshot_id IS NULL THEN 'missing_kb_snapshot'
      WHEN deploy_hash IS NULL THEN 'missing_deploy_hash'
    END,
    project_id::text, workspace_id, knowledge_base_id, kb_snapshot_id, deploy_hash
  FROM asking_task
  WHERE workspace_id IS NULL
     OR knowledge_base_id IS NULL
     OR kb_snapshot_id IS NULL
     OR deploy_hash IS NULL

  UNION ALL

  SELECT 'instruction', id::text,
    CASE
      WHEN project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
        THEN 'legacy_bridge_only'
      WHEN workspace_id IS NULL THEN 'missing_workspace'
      WHEN knowledge_base_id IS NULL THEN 'missing_knowledge_base'
      WHEN kb_snapshot_id IS NULL THEN 'missing_kb_snapshot'
      WHEN deploy_hash IS NULL THEN 'missing_deploy_hash'
    END,
    project_id::text, workspace_id, knowledge_base_id, kb_snapshot_id, deploy_hash
  FROM instruction
  WHERE workspace_id IS NULL
     OR knowledge_base_id IS NULL
     OR kb_snapshot_id IS NULL
     OR deploy_hash IS NULL

  UNION ALL

  SELECT 'sql_pair', id::text,
    CASE
      WHEN project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
        THEN 'legacy_bridge_only'
      WHEN workspace_id IS NULL THEN 'missing_workspace'
      WHEN knowledge_base_id IS NULL THEN 'missing_knowledge_base'
      WHEN kb_snapshot_id IS NULL THEN 'missing_kb_snapshot'
      WHEN deploy_hash IS NULL THEN 'missing_deploy_hash'
    END,
    project_id::text, workspace_id, knowledge_base_id, kb_snapshot_id, deploy_hash
  FROM sql_pair
  WHERE workspace_id IS NULL
     OR knowledge_base_id IS NULL
     OR kb_snapshot_id IS NULL
     OR deploy_hash IS NULL

  UNION ALL

  SELECT 'view', id::text,
    CASE
      WHEN project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
        THEN 'legacy_bridge_only'
      WHEN workspace_id IS NULL THEN 'missing_workspace'
      WHEN knowledge_base_id IS NULL THEN 'missing_knowledge_base'
      WHEN kb_snapshot_id IS NULL THEN 'missing_kb_snapshot'
      WHEN deploy_hash IS NULL THEN 'missing_deploy_hash'
    END,
    project_id::text, workspace_id, knowledge_base_id, kb_snapshot_id, deploy_hash
  FROM "view"
  WHERE workspace_id IS NULL
     OR knowledge_base_id IS NULL
     OR kb_snapshot_id IS NULL
     OR deploy_hash IS NULL

  UNION ALL

  SELECT 'model', id::text,
    CASE
      WHEN project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
        THEN 'legacy_bridge_only'
      WHEN workspace_id IS NULL THEN 'missing_workspace'
      WHEN knowledge_base_id IS NULL THEN 'missing_knowledge_base'
      WHEN kb_snapshot_id IS NULL THEN 'missing_kb_snapshot'
      WHEN deploy_hash IS NULL THEN 'missing_deploy_hash'
    END,
    project_id::text, workspace_id, knowledge_base_id, kb_snapshot_id, deploy_hash
  FROM model
  WHERE workspace_id IS NULL
     OR knowledge_base_id IS NULL
     OR kb_snapshot_id IS NULL
     OR deploy_hash IS NULL

  UNION ALL

  SELECT 'relation', id::text,
    CASE
      WHEN project_id IS NOT NULL
        AND workspace_id IS NULL
        AND knowledge_base_id IS NULL
        AND kb_snapshot_id IS NULL
        AND deploy_hash IS NULL
        THEN 'legacy_bridge_only'
      WHEN workspace_id IS NULL THEN 'missing_workspace'
      WHEN knowledge_base_id IS NULL THEN 'missing_knowledge_base'
      WHEN kb_snapshot_id IS NULL THEN 'missing_kb_snapshot'
      WHEN deploy_hash IS NULL THEN 'missing_deploy_hash'
    END,
    project_id::text, workspace_id, knowledge_base_id, kb_snapshot_id, deploy_hash
  FROM relation
  WHERE workspace_id IS NULL
     OR knowledge_base_id IS NULL
     OR kb_snapshot_id IS NULL
     OR deploy_hash IS NULL
) AS affected_rows
ORDER BY table_name, row_id
LIMIT 200;
