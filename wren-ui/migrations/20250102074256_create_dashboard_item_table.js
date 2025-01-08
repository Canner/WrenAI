/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('dashboard_item', (table) => {
    table.increments('id').primary();
    table
      .integer('dashboard_id')
      .notNullable()
      .comment('Reference to dashboard.id');
    table
      .string('type')
      .notNullable()
      .comment(
        'The chart type of the dashboard item, such as: bar, table, number, etc',
      );
    table
      .jsonb('layout')
      .notNullable()
      .comment(
        'The layout of the dashboard item, according to which library it is, such as: { x: 0, y: 0, w: 6, h: 6 }',
      );
    table
      .jsonb('detail')
      .notNullable()
      .comment(
        'The detail of the dashboard item, such as: { chartSchema: {...}, sql: "..." } ',
      );

    table
      .foreign('dashboard_id')
      .references('dashboard.id')
      .onDelete('CASCADE');
    table.index(['dashboard_id', 'type']);
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('dashboard_item');
};
