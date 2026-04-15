/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.boolean('is_platform_admin').notNullable().defaultTo(false);
    table.string('default_workspace_id').nullable();
    table.index(['is_platform_admin']);
    table.index(['default_workspace_id']);
    table
      .foreign('default_workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('SET NULL');
  });

  await knex.schema.alterTable('workspace', (table) => {
    table.string('kind').notNullable().defaultTo('regular');
    table.index(['kind']);
  });

  await knex.schema.alterTable('knowledge_base', (table) => {
    table.string('kind').notNullable().defaultTo('regular');
    table.index(['workspace_id', 'kind']);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX workspace_single_default_kind_idx
    ON workspace (kind)
    WHERE kind = 'default'
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS workspace_single_default_kind_idx');

  await knex.schema.alterTable('knowledge_base', (table) => {
    table.dropIndex(['workspace_id', 'kind']);
    table.dropColumn('kind');
  });

  await knex.schema.alterTable('workspace', (table) => {
    table.dropIndex(['kind']);
    table.dropColumn('kind');
  });

  await knex.schema.alterTable('user', (table) => {
    table.dropForeign(['default_workspace_id']);
    table.dropIndex(['default_workspace_id']);
    table.dropIndex(['is_platform_admin']);
    table.dropColumn('default_workspace_id');
    table.dropColumn('is_platform_admin');
  });
};
