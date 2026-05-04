/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('sql_pair', (table) => {
    // Drop the existing foreign key constraint
    table.dropForeign('project_id');

    // Add the foreign key constraint with onDelete CASCADE
    table
      .foreign('project_id')
      .references('id')
      .inTable('project')
      .onDelete('CASCADE');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('sql_pair', (table) => {
    // Drop the foreign key constraint with CASCADE
    table.dropForeign('project_id');

    // Restore the original foreign key constraint without CASCADE
    table.foreign('project_id').references('id').inTable('project');
  });
};
