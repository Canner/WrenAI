/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('role', (table) => {
    table.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex('role').whereNull('is_active').update({ is_active: true });
  await knex.schema.alterTable('role', (table) => {
    table.index(['is_active'], 'role_is_active_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('role', (table) => {
    table.dropIndex(['is_active'], 'role_is_active_idx');
    table.dropColumn('is_active');
  });
};
