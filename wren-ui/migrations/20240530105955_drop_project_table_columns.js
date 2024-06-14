/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.table('project', (table) => {
    table.dropColumn('configurations');
    table.dropColumn('credentials');
    table.dropColumn('project_id');
    table.dropColumn('dataset_id');
    table.dropColumn('init_sql');
    table.dropColumn('extensions');
    table.dropColumn('host');
    table.dropColumn('port');
    table.dropColumn('database');
    table.dropColumn('user');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('project', (table) => {
    table
      .jsonb('configurations')
      .nullable()
      .comment(
        'duckdb configurations that can be set in session, eg: { "key1": "value1", "key2": "value2" }',
      );
    table
      .text('credentials')
      .nullable()
      .comment('database connection credentials');
    table
      .string('project_id')
      .nullable()
      .comment('gcp project id, big query specific');
    table.string('dataset_id').nullable().comment('big query datasetId');
    table.text('init_sql');
    table
      .jsonb('extensions')
      .nullable()
      .comment(
        'duckdb extensions, will be a array-like string like, eg: ["extension1", "extension2"]',
      );
    table
      .string('host')
      .nullable()
      .comment('postgresql host, postgresql specific');
    table
      .integer('port')
      .nullable()
      .comment('postgresql port, postgresql specific');
    table
      .string('database')
      .nullable()
      .comment('postgresql database, postgresql specific');
    table
      .string('user')
      .nullable()
      .comment('postgresql user, postgresql specific');
  });
};
