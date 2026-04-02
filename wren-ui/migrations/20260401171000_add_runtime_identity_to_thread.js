/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('thread', (table) => {
    table.string('workspace_id').nullable();
    table.string('knowledge_base_id').nullable();
    table.string('kb_snapshot_id').nullable();
    table.string('deploy_hash').nullable();
    table.string('actor_user_id').nullable();

    table.index(['workspace_id']);
    table.index(['knowledge_base_id']);
    table.index(['kb_snapshot_id']);
    table.index(['deploy_hash']);
    table.index(['actor_user_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('thread', (table) => {
    table.dropIndex(['workspace_id']);
    table.dropIndex(['knowledge_base_id']);
    table.dropIndex(['kb_snapshot_id']);
    table.dropIndex(['deploy_hash']);
    table.dropIndex(['actor_user_id']);

    table.dropColumn('workspace_id');
    table.dropColumn('knowledge_base_id');
    table.dropColumn('kb_snapshot_id');
    table.dropColumn('deploy_hash');
    table.dropColumn('actor_user_id');
  });
};
