/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('dashboard_item', (table) => {
    table
      .string('display_name')
      .comment('Display name of the dashboard item')
      .nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('dashboard_item', (table) => {
    table.dropColumn('display_name');
  });
};
