/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('audit_event', (table) => {
    table.string('scope_type').nullable();
    table.string('scope_id').nullable();
    table.index(['scope_type', 'scope_id'], 'audit_event_scope_idx');
  });

  await knex.raw('ALTER TABLE audit_event ALTER COLUMN workspace_id DROP NOT NULL');

  await knex.schema.createTable('rate_limit_bucket', (table) => {
    table.string('key').primary();
    table.integer('count').notNullable().defaultTo(0);
    table.timestamp('reset_at', { useTz: true }).notNullable();
    table.timestamps(true, true);
    table.index(['reset_at'], 'rate_limit_bucket_reset_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('rate_limit_bucket');

  await knex.schema.alterTable('audit_event', (table) => {
    table.dropIndex(['scope_type', 'scope_id'], 'audit_event_scope_idx');
    table.dropColumn('scope_type');
    table.dropColumn('scope_id');
  });
};
