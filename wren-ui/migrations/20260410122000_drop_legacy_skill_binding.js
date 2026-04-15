const LEGACY_COMPAT_COMMENT =
  'Legacy compatibility table. V2 runtime ownership moved to skill_definition; do not add new runtime fields here.';

const ROLLBACK_COMMENT =
  'Recreated by rollback of 20260410122000_drop_legacy_skill_binding. Legacy binding rows are not restored automatically.';

const loadSingleCount = async (knex, sql) => {
  const { rows } = await knex.raw(sql);
  return Number(rows?.[0]?.count || 0);
};

const assertMigrationSourceBindingColumn = async (knex) => {
  const hasColumn = await knex.schema.hasColumn(
    'skill_definition',
    'migration_source_binding_id',
  );

  if (!hasColumn) {
    throw new Error(
      'Cannot drop skill_binding before skill_definition.migration_source_binding_id exists.',
    );
  }
};

const assertNoDuplicateMigrationSources = async (knex) => {
  const duplicateCount = await loadSingleCount(
    knex,
    `
      SELECT COUNT(*) AS count
      FROM (
        SELECT migration_source_binding_id
        FROM skill_definition
        WHERE migration_source_binding_id IS NOT NULL
        GROUP BY migration_source_binding_id
        HAVING COUNT(*) > 1
      ) AS duplicate_sources
    `,
  );

  if (duplicateCount > 0) {
    throw new Error(
      `Cannot drop skill_binding: found ${duplicateCount} duplicated migration_source_binding_id values in skill_definition.`,
    );
  }
};

const assertBindingGroupsWereMaterialized = async (knex) => {
  const incompleteGroupCount = await loadSingleCount(
    knex,
    `
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
      SELECT COUNT(*) AS count
      FROM binding_groups AS bg
      LEFT JOIN migrated_clones AS mc
        ON mc.skill_definition_id = bg.skill_definition_id
      WHERE bg.binding_group_count > 1
        AND COALESCE(mc.clone_count, 0) < bg.binding_group_count - 1
    `,
  );

  if (incompleteGroupCount > 0) {
    throw new Error(
      `Cannot drop skill_binding: found ${incompleteGroupCount} skill definitions whose legacy binding groups have not been fully materialized into runtime skills.`,
    );
  }
};

const assertBindingsBackfilledToRuntimeScope = async (knex) => {
  const missingRuntimeSettingsCount = await loadSingleCount(
    knex,
    `
      SELECT COUNT(*) AS count
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
    `,
  );

  if (missingRuntimeSettingsCount > 0) {
    throw new Error(
      `Cannot drop skill_binding: found ${missingRuntimeSettingsCount} skill definitions with legacy bindings but missing runtime settings on skill_definition.`,
    );
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasSkillBindingTable = await knex.schema.hasTable('skill_binding');
  if (!hasSkillBindingTable) {
    return;
  }

  await assertMigrationSourceBindingColumn(knex);
  await assertNoDuplicateMigrationSources(knex);
  await assertBindingGroupsWereMaterialized(knex);
  await assertBindingsBackfilledToRuntimeScope(knex);

  await knex.schema.dropTable('skill_binding');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasSkillBindingTable = await knex.schema.hasTable('skill_binding');
  if (hasSkillBindingTable) {
    return;
  }

  await knex.schema.createTable('skill_binding', (table) => {
    table.string('id').primary();
    table.string('knowledge_base_id').notNullable();
    table.string('kb_snapshot_id').nullable();
    table.string('skill_definition_id').notNullable();
    table.string('connector_id').nullable();
    table.jsonb('binding_config').nullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.string('created_by').nullable();
    table.timestamps(true, true);

    table
      .foreign('knowledge_base_id')
      .references('id')
      .inTable('knowledge_base')
      .onDelete('CASCADE');
    table
      .foreign('kb_snapshot_id')
      .references('id')
      .inTable('kb_snapshot')
      .onDelete('SET NULL');
    table
      .foreign('skill_definition_id')
      .references('id')
      .inTable('skill_definition')
      .onDelete('CASCADE');
    table
      .foreign('connector_id')
      .references('id')
      .inTable('connector')
      .onDelete('SET NULL');
    table.index(['knowledge_base_id']);
    table.index(['kb_snapshot_id']);
  });

  await knex.raw(`
    COMMENT ON TABLE skill_binding IS
    '${ROLLBACK_COMMENT} ${LEGACY_COMPAT_COMMENT}'
  `);
};
