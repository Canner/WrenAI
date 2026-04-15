/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('knowledge_base', (table) => {
    table.integer('runtime_project_id').nullable();
    table
      .foreign('runtime_project_id')
      .references('id')
      .inTable('project')
      .onDelete('SET NULL');
    table.index(['runtime_project_id']);
  });

  await knex.schema.alterTable('connector', (table) => {
    table.string('database_provider').nullable();
    table.string('trino_catalog_name').nullable();
    table.index(['database_provider']);
  });

  await knex.schema.raw(`
    CREATE UNIQUE INDEX connector_trino_catalog_name_uq
    ON connector(trino_catalog_name)
    WHERE trino_catalog_name IS NOT NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS connector_trino_catalog_name_uq');

  await knex.schema.alterTable('connector', (table) => {
    table.dropIndex(['database_provider']);
    table.dropColumn('trino_catalog_name');
    table.dropColumn('database_provider');
  });

  await knex.schema.alterTable('knowledge_base', (table) => {
    table.dropIndex(['runtime_project_id']);
    table.dropForeign(['runtime_project_id']);
    table.dropColumn('runtime_project_id');
  });
};
