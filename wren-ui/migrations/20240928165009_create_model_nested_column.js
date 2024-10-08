/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('model_nested_column', (table) => {
    table.increments('id').comment('ID');
    table.integer('model_id').comment('Reference to model ID');
    table.integer('column_id').comment('Reference to column ID');
    table
      .string('column_path')
      .comment(
        'The path of the nested column, array of strings, [sourceColumnName..sourceColumnName(n)]',
      );

    table.string('display_name').comment('Display name of the nested column');
    table
      .string('source_column_name')
      .comment('the nested column name in the datasource');
    table
      .string('reference_name')
      .comment('The name used in the MDL structure and query');
    table
      .string('type')
      .comment('Data type, refer to the nested column type in the datasource')
      .nullable();
    table
      .text('properties')
      .comment(
        'nested column properties, a json string, the description should be stored here',
      )
      .nullable();

    table
      .foreign('column_id')
      .references('model_column.id')
      .onDelete('CASCADE');
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('model_nested_column');
};
