/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('thread_response', (table) => {
    table
      .string('response_kind')
      .nullable()
      .comment('Semantic response kind, e.g. ANSWER or CHART_FOLLOWUP');
    table
      .integer('source_response_id')
      .nullable()
      .references('id')
      .inTable('thread_response')
      .onDelete('SET NULL');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('thread_response', (table) => {
    table.dropColumn('source_response_id');
    table.dropColumn('response_kind');
  });
};
