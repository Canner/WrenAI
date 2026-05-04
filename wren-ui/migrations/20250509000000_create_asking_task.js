/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('asking_task', (table) => {
    table.increments('id').primary();
    table.string('query_id').notNullable().unique();
    table.text('question');
    table.jsonb('detail').defaultTo('{}');

    table
      .integer('thread_id')
      .references('id')
      .inTable('thread')
      .onDelete('CASCADE');

    table
      .integer('thread_response_id')
      .references('id')
      .inTable('thread_response')
      .onDelete('CASCADE');

    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('asking_task');
};
