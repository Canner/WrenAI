/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('thread_response_explain', (table) => {
    table.increments('id').comment('ID');
    table
      .integer('thread_response_id')
      .comment('Reference to thread_response.id');
    table
      .foreign('thread_response_id')
      .references('thread_response.id')
      .onDelete('CASCADE');

    table.string('query_id').nullable();
    table.string('status').nullable();
    table.jsonb('detail').nullable();
    table.jsonb('error').nullable();

    // timestamps
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('thread_response_explain');
};
