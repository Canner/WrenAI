/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('schedule_job', (table) => {
    table.string('knowledge_base_id').nullable().alter();
    table.string('kb_snapshot_id').nullable().alter();
    table.string('deploy_hash').nullable().alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex('schedule_job')
    .whereNull('knowledge_base_id')
    .orWhereNull('kb_snapshot_id')
    .orWhereNull('deploy_hash')
    .del();

  await knex.schema.alterTable('schedule_job', (table) => {
    table.string('knowledge_base_id').notNullable().alter();
    table.string('kb_snapshot_id').notNullable().alter();
    table.string('deploy_hash').notNullable().alter();
  });
};
