/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('view', (table) => {
    table.increments('id').comment('ID');
    table.integer('project_id').comment('Reference to project.id');

    // basic info
    table.string('name').comment('the view name');
    table.text('statement').comment('the sql statement of this view');

    // cache setting
    table.boolean('cached').comment('view is cached or not');
    table
      .string('refresh_time')
      .comment(
        'contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"',
      )
      .nullable();

    // view properties
    table
      .text('properties')
      .comment(
        'view properties, a json string, the description and displayName should be stored here',
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
  return knex.schema.dropTable('view');
};
