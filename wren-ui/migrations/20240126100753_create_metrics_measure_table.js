/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  // name string
  // expression string
  // granularity string, nullable

  return knex.schema.createTable('metric_measure', (table) => {
    table.increments('id').comment('ID');
    table.integer('metric_id').comment('Reference to metric ID');
    table.string('name').comment('Measure name');
    table
      .text('expression')
      .comment('Expression for the measure')
      .comment(
        'the expression of measure, eg: "Sum", "Everage", or customize expression',
      );
    table
      .string('granularity')
      .comment(
        'Granularity for the measure, eg: "day", "hour", "minute", "year"',
      )
      .nullable();
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('metric_measure');
};
