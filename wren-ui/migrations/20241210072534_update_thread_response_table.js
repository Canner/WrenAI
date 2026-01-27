/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('thread_response', (table) => {
    if (knex.client.config.client === 'mysql2') {
      table.json('chart_detail').nullable();
    } else {
      table.jsonb('chart_detail').nullable();
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('thread_response', (table) => {
    table.dropColumn('chart_detail');
  });
};
