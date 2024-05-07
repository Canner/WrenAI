/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable('relation', (table) => {
      table
        .foreign('from_column_id')
        .references('model_column.id')
        .onDelete('CASCADE');
    })
    .alterTable('relation', (table) => {
      table
        .foreign('to_column_id')
        .references('model_column.id')
        .onDelete('CASCADE');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .alterTable('relation', (table) => {
      table.dropForeign('from_column_id');
    })
    .alterTable('relation', (table) => {
      table.dropForeign('to_column_id');
    });
};
