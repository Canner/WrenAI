/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('api_history', (table) => {
    table.increments('id').primary();

    // Project
    table.integer('project_id').notNullable();

    // Thread
    table.integer('thread_id').notNullable();

    // API Type
    table.string('api_type').notNullable();

    // API Input
    table.jsonb('api_input').notNullable();

    // Request
    table.jsonb('headers').notNullable();
    table.jsonb('request_payload').notNullable();

    // Response
    table.jsonb('response_payload').notNullable();

    // Result
    table.string('status').notNullable();
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
