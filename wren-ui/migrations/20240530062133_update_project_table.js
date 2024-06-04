/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

// create connectionInfo column in project table
exports.up = function (knex) {
  return knex.schema.table('project', (table) => {
    table
      .jsonb('connection_info')
      .nullable()
      .comment('Connection information for the project');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('project', (table) => {
    table.dropColumn('connection_info');
  });
};
