/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
// add summary column to thread_response table
exports.up = function (knex) {
  return knex.schema.alterTable('thread_response', (table) => {
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
