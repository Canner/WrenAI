/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('project', (table) => {
    table
      .string('language')
      .comment('The project language applied to AI')
      .defaultTo('EN');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('project', (table) => {
    table.dropColumn('language');
  });
};
