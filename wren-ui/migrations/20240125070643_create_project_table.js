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
    table
      .text('credentials')
      .nullable()
      .comment('database connection credentials');

    // bq
    table
      .string('project_id')
      .nullable()
      .comment('gcp project id, big query specific');
    table.string('dataset_id').nullable().comment('big query datasetId');

    // duckdb
    table
      .jsonb('init_sql')
      .nullable()
      .comment('init sql for establishing duckdb environment');
    // knex jsonb ref: https://knexjs.org/guide/schema-builder.html#json
    table
      .jsonb('extensions')
      .nullable()
      .comment(
        'duckdb extensions, will be a array-like string like, eg: ["extension1", "extension2"]',
      );
    table
      .jsonb('configurations')
      .nullable()
      .comment(
        'duckdb configurations that can be set in session, eg: { "key1": "value1", "key2": "value2" }',
      );

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
