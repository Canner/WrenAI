/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('project', (table) => {
    table
      .string('version')
      .nullable()
      .comment('data source version information');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('project', (table) => {
    table.dropColumn('version');
  });
};
