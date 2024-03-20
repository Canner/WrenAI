/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('project', (table) => {
    table.increments('id').comment('ID');
    table
      .string('type')
      .comment(
        'project datasource type. ex: bigquery, mysql, postgresql, mongodb, etc',
      );
    table.string('display_name').comment('project display name');

    // bq
    table.string('project_id').comment('gcp project id, big query specific');
    table
      .text('credentials')
      .comment('project credentials, big query specific');
    table.string('dataset_id').comment('big query datasetId');

    // not sure to store or not, the catalog & schema in the manifest
    table.string('catalog').comment('catalog name');
    table.string('schema').comment('');

    // sample datset
    table.string('sample_dataset').nullable().comment('sample dataset name');

    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('project');
};
