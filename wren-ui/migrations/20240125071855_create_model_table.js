/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('model', (table) => {
    table.increments('id').comment('ID');
    table.integer('project_id').comment('Reference to project.id');

    // basic info
    table.string('name').comment('the model display name');
    table
      .string('table_name')
      .comment('referenced table name in the datasource');
    table.text('ref_sql').comment('Reference SQL');

    // cache setting
    table.boolean('cached').comment('model is cached or not');
    table
      .string('refresh_time')
      .comment(
        'contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"'
      )
      .nullable();

    // model properties
    table
      .text('properties')
      .comment(
        'model properties, a json string, the description and displayName should be stored here'
      )
      .nullable();

    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('model');
};
