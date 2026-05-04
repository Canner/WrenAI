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
    table.text('sql').notNullable();
    table.string('question', 1000).notNullable();
    table.timestamps(true, true);

    table.foreign('project_id').references('id').inTable('project');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('sql_pair');
};
