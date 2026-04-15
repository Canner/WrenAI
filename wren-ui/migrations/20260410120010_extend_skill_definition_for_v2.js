/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('skill_definition', (table) => {
    table.string('catalog_id').nullable();
    table.text('instruction').nullable();
    table.boolean('is_enabled').notNullable().defaultTo(true);
    table.string('execution_mode').notNullable().defaultTo('inject_only');
    table.string('connector_id').nullable();
    table.jsonb('runtime_config_json').nullable();
    table.jsonb('kb_suggestion_ids').nullable();
    table.string('installed_from').notNullable().defaultTo('custom');
    table.string('migration_source_binding_id').nullable();

    table
      .foreign('catalog_id')
      .references('id')
      .inTable('skill_marketplace_catalog')
      .onDelete('SET NULL');
    table
      .foreign('connector_id')
      .references('id')
      .inTable('connector')
      .onDelete('SET NULL');

    table.index(['workspace_id', 'is_enabled']);
    table.index(['catalog_id']);
    table.index(['connector_id']);
    table.unique(['migration_source_binding_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('skill_definition', (table) => {
    table.dropUnique(['migration_source_binding_id']);
    table.dropIndex(['connector_id']);
    table.dropIndex(['catalog_id']);
    table.dropIndex(['workspace_id', 'is_enabled']);

    table.dropForeign(['connector_id']);
    table.dropForeign(['catalog_id']);

    table.dropColumn('migration_source_binding_id');
    table.dropColumn('installed_from');
    table.dropColumn('kb_suggestion_ids');
    table.dropColumn('runtime_config_json');
    table.dropColumn('connector_id');
    table.dropColumn('execution_mode');
    table.dropColumn('is_enabled');
    table.dropColumn('instruction');
    table.dropColumn('catalog_id');
  });
};
