/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('dashboard', 'workspace_id');
  if (hasColumn) {
    return;
  }

  await knex.schema.alterTable('dashboard', (table) => {
    table.string('workspace_id').nullable();
    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('SET NULL');
    table.index(['workspace_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('dashboard', 'workspace_id');
  if (!hasColumn) {
    return;
  }

  await knex.schema.alterTable('dashboard', (table) => {
    table.dropIndex(['workspace_id']);
    table.dropForeign(['workspace_id']);
    table.dropColumn('workspace_id');
  });
};
