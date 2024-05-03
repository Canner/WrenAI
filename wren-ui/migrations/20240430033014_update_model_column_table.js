/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  // Drop this column FE is no longer using it.
  return knex.schema.table('model_column', function (table) {
    table.dropColumn('diagram');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('model_column', function (table) {
    table
      .text('diagram')
      .comment('for FE to store the calculated field diagram')
      .nullable();
  });
};
