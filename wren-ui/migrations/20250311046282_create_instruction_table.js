/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('instruction', (table) => {
    table.increments('id').primary();
    if (knex.client.config.client === 'mysql2') {
    table
        .integer('project_id')
        .unsigned()
        .notNullable()
        .comment('Reference to project.id');
    } else {
      table
        .integer('project_id')
        .notNullable()
        .comment('Reference to project.id');
    }
    table.text('instruction').notNullable().comment('The instruction text');
    if (knex.client.config.client === 'mysql2') {
      table.json('questions').notNullable().comment('The questions array');
    } else {
      table.jsonb('questions').notNullable().comment('The questions array');
    }
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
