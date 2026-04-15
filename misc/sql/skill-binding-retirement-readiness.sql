-- Skill binding retirement readiness audit
--
-- Run this against the real PostgreSQL app database before introducing the
-- final migration that drops the legacy skill_binding table.

-- 1) Baseline row counts
SELECT COUNT(*) AS total_skill_binding_rows
FROM skill_binding;

SELECT COUNT(*) AS total_runtime_skills
FROM skill_definition;

SELECT COUNT(*) AS runtime_skills_with_migration_source_binding_id
FROM skill_definition
WHERE migration_source_binding_id IS NOT NULL;

-- 2) Legacy binding signature groups that still have not been fully materialized
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
SELECT
  bg.skill_definition_id,
  bg.binding_group_count,
  COALESCE(mc.clone_count, 0) AS clone_count,
  GREATEST(bg.binding_group_count - 1, 0) AS expected_clone_count
FROM binding_groups AS bg
LEFT JOIN migrated_clones AS mc
  ON mc.skill_definition_id = bg.skill_definition_id
WHERE bg.binding_group_count > 1
  AND COALESCE(mc.clone_count, 0) < bg.binding_group_count - 1
ORDER BY bg.binding_group_count DESC, bg.skill_definition_id
LIMIT 100;

-- 3) Original runtime skills that still have legacy bindings but missing runtime fields
SELECT
  sd.id AS skill_definition_id,
  sd.name,
  sd.execution_mode,
  sd.is_enabled,
  sd.kb_suggestion_ids
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
  )
ORDER BY sd.id
LIMIT 100;

-- 4) migration_source_binding_id should remain unique among runtime skills
SELECT
  migration_source_binding_id,
  COUNT(*) AS duplicate_count
FROM skill_definition
WHERE migration_source_binding_id IS NOT NULL
GROUP BY migration_source_binding_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, migration_source_binding_id;

-- 5) migrated_from_binding runtime skills created by the backfill script
SELECT
  installed_from,
  COUNT(*) AS skill_count
FROM skill_definition
GROUP BY installed_from
ORDER BY installed_from;

-- 6) Spot-check migrated runtime settings side-by-side
SELECT
  sb.id AS binding_id,
  sb.skill_definition_id AS original_skill_definition_id,
  sd.id AS migrated_runtime_skill_id,
  sd.name AS migrated_runtime_skill_name,
  sb.connector_id AS binding_connector_id,
  sd.connector_id AS runtime_connector_id,
  sb.binding_config AS binding_config,
  sd.runtime_config_json AS runtime_config_json,
  sb.enabled AS binding_enabled,
  sd.is_enabled AS runtime_enabled,
  sd.kb_suggestion_ids AS runtime_kb_suggestion_ids
FROM skill_binding AS sb
LEFT JOIN skill_definition AS sd
  ON sd.migration_source_binding_id = sb.id
ORDER BY sb.skill_definition_id, sb.knowledge_base_id, sb.id
LIMIT 100;
