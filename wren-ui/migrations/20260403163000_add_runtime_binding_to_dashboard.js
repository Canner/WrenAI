/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('dashboard', (table) => {
    table.string('knowledge_base_id').nullable();
    table.string('kb_snapshot_id').nullable();
    table.string('deploy_hash').nullable();
    table.string('created_by').nullable();

    table
      .foreign('knowledge_base_id')
      .references('id')
      .inTable('knowledge_base')
      .onDelete('SET NULL');
    table
      .foreign('kb_snapshot_id')
      .references('id')
      .inTable('kb_snapshot')
      .onDelete('SET NULL');
    table
      .foreign('created_by')
      .references('id')
      .inTable('user')
      .onDelete('SET NULL');

    table.index(['knowledge_base_id']);
    table.index(['kb_snapshot_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('dashboard', (table) => {
    table.dropIndex(['knowledge_base_id']);
    table.dropIndex(['kb_snapshot_id']);
    table.dropForeign(['knowledge_base_id']);
    table.dropForeign(['kb_snapshot_id']);
    table.dropForeign(['created_by']);
    table.dropColumn('knowledge_base_id');
    table.dropColumn('kb_snapshot_id');
    table.dropColumn('deploy_hash');
    table.dropColumn('created_by');
  });
};
