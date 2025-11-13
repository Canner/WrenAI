/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('schema_change', (table) => {
    table.increments('id').comment('ID');
    table.integer('project_id').comment('Reference to project.id');

    // schema change info
    if (knex.client.config.client === 'mysql2') {
      table.json('change').nullable();
      table.json('resolve').nullable();
    } else {
      table.jsonb('change').nullable();
      table.jsonb('resolve').nullable();
    }

    // timestamps
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('schema_change');
};
