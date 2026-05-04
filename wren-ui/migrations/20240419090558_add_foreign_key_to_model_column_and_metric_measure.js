/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable('model_column', (table) => {
      table.foreign('model_id').references('model.id').onDelete('CASCADE');
    })
    .alterTable('metric_measure', (table) => {
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
