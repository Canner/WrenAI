/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('knowledge_base', (table) => {
    table.dropColumn('recommendation_query_id');
    table.dropColumn('recommendation_status');
    table.dropColumn('recommendation_questions');
    table.dropColumn('recommendation_error');
  });
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('knowledge_base', (table) => {
    table.string('recommendation_query_id').nullable();
    table.string('recommendation_status').nullable();
    table.jsonb('recommendation_questions').nullable();
    table.jsonb('recommendation_error').nullable();
  });
};
