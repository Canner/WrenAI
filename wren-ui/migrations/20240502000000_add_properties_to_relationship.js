/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
// add properties column to relation table
exports.up = function (knex) {
  return knex.schema.alterTable('relation', (table) => {
    table
      .text('properties')
      .comment(
        'column properties, a json string, the description of relationships should be stored here',
      )
      .nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('relation', (table) => {
    table.dropColumns('properties');
  });
};
