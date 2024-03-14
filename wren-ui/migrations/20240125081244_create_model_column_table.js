/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('model_column', (table) => {
      table.increments('id').comment('ID');
      table.integer('model_id').comment('Reference to model ID');
      // column name
      table.boolean('is_calculated').comment('Is calculated field');

      table.string('display_name').comment('Display name of the column');
      table
        .string('source_column_name')
        .comment('the column name in the datasource');
      table
        .string('reference_name')
        .comment('The name used in the MDL structure and query');

      // aggregation
      table
        .text('aggregation')
        .comment(
          'Expression for the column, could be custom field or calculated field expression, eg: sum, aggregate',
        )
        .nullable();
      table
        .text('lineage')
        .comment(
          'the selected field in calculated field, array of ids, [relationId 1, relationId 2, columnId], last one should be columnId, while others are relationId',
        )
        .nullable();
      table
        .text('diagram')
        .comment('for FE to store the calculated field diagram')
        .nullable();

      table
        .string('type')
        .comment('Data type, refer to the column type in the datasource')
        .nullable();
      table.boolean('not_null').comment('Is not null');
      // is primary key
      table.boolean('is_pk').comment('Is primary key of the table');
      table
        .text('properties')
        .comment(
          'column properties, a json string, the description and displayName should be stored here',
        )
        .nullable();

      table.timestamps(true, true);
    })
    .then(() =>
      knex.schema.table('model_column', (table) => {
        // Explicitly add unique constraint to avoid using the deprecated signature
        table.unique(['model_id', 'source_column_name'], {
          indexName: 'model_id_source_column_name_unique',
          storageEngineIndexType: 'BTREE', // This line is optional and can be adjusted based on your DB's engine
        });
        table.unique(['model_id', 'reference_name'], {
          indexName: 'model_id_reference_name_unique',
          storageEngineIndexType: 'BTREE', // This line is optional and can be adjusted based on your DB's engine
        });
      }),
    );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('model_column');
};
