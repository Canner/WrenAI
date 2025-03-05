/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('sql_pair', (table) => {
    table.increments('id').primary();
    table
      .integer('project_id')
      .notNullable()
      .comment('Reference to project.id');
    table.string('sql', 10000).notNullable();
    table.string('question', 1000).notNullable();
    table.index(['project_id']);
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('sql_pair');
};
