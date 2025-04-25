/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('api_history', (table) => {
    table.string('id').primary();

    // Project
    table.integer('project_id').notNullable();
    table
      .foreign('project_id')
      .references('id')
      .inTable('project')
      .onDelete('CASCADE');

    // Thread
    table.string('thread_id');

    // API Type
    table.string('api_type').notNullable();

    // Request
    table.jsonb('headers');
    table.jsonb('request_payload');

    // Response
    table.jsonb('response_payload');

    // Result
    table.integer('status_code').notNullable();
    table.integer('duration_ms').notNullable();
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('api_history');
};
