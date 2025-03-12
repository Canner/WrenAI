/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('instruction', (table) => {
    table.increments('id').primary();
    table
      .integer('project_id')
      .notNullable()
      .comment('Reference to project.id');
    table.text('instruction').notNullable().comment('The instruction text');
    table.jsonb('questions').notNullable().comment('The questions array');
    table
      .boolean('is_default')
      .notNullable()
      .comment('Whether this instruction should be used in each asking');
    table.timestamps(true, true);

    table.foreign('project_id').references('project.id').onDelete('CASCADE');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('instruction');
};
