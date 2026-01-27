/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable('model_column', (table) => {
      if (knex.client.config.client === 'mysql2') {
        table.integer('model_id').unsigned().alter();
      }
      table.foreign('model_id').references('model.id').onDelete('CASCADE');
    })
    .alterTable('metric_measure', (table) => {
      if (knex.client.config.client === 'mysql2') {
        table.integer('metric_id').unsigned().alter();
      }
      table.foreign('metric_id').references('metric.id').onDelete('CASCADE');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .alterTable('model_column', (table) => {
      table.dropForeign('model_id');
    })
    .alterTable('metric_measure', (table) => {
      table.dropForeign('metric_id');
    });
};
