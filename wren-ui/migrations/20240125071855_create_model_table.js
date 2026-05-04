/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('model', (table) => {
      table.increments('id').comment('ID');
      table.integer('project_id').comment('Reference to project.id');

      // basic info
      table.string('display_name').comment('the model display name');
      table
        .string('source_table_name')
        .comment(
          'referenced table name in the datasource, can not be duplicated in the same project',
        );
      table
        .string('reference_name')
        .comment(
          'the name used in MDL structure, should be unique between models in the same project',
        );
      table.text('ref_sql').comment('Reference SQL');

      // cache setting
      table.boolean('cached').comment('model is cached or not');
      table
        .string('refresh_time')
        .comment(
          'contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"',
        )
        .nullable();

      // model properties
      table
        .text('properties')
        .comment(
          'model properties, a json string, the description and displayName should be stored here',
        )
        .nullable();

      table.timestamps(true, true);
    })
    .then(() =>
      knex.schema.table('model', (table) => {
        // Explicitly add unique constraint to avoid using the deprecated signature
        table.unique(['project_id', 'source_table_name'], {
          indexName: 'project_id_source_table_name_unique',
          storageEngineIndexType: 'BTREE', // This line is optional and can be adjusted based on your DB's engine
        });
        table.unique(['project_id', 'reference_name'], {
          indexName: 'project_id_reference_name_unique',
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
  return knex.schema.dropTable('model');
};
