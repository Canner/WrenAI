/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
// add pg related columns to project table
exports.up = function (knex) {
  return knex.schema.alterTable('thread_response', (table) => {
    // pg
    table
      .string('summary')
      .nullable()
      .comment('the summary of the thread response');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('thread_response', (table) => {
    table.dropColumns('summary');
  });
};
