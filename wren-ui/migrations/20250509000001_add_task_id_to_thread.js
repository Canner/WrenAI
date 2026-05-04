/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('thread_response', (table) => {
    table
      .integer('asking_task_id')
      .nullable()
      .references('id')
      .inTable('asking_task')
      .onDelete('SET NULL');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('thread_response', (table) => {
    table.dropForeign('asking_task_id');
    table.dropColumn('asking_task_id');
  });
};
