/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('deploy_log', (table) => {
    table.increments('id').comment('ID');
    table.integer('project_id').comment('Reference to project.id');

    // basic info
    table.jsonb('manifest').comment('the deployed manifest');
    table.string('hash').comment('the hash of the manifest');

    // status
    table.string('status').nullable().comment('deploy status');
    table.string('error').nullable().comment('deploy error message');

    // timestamps
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('deploy_log');
};
