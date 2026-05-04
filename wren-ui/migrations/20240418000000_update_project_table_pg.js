/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
// add pg related columns to project table
exports.up = function (knex) {
  return knex.schema.alterTable('project', (table) => {
    // pg
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

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('project', (table) => {
    table.dropColumns('host', 'port', 'database', 'user');
  });
};
