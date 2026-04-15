/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('knowledge_base', (table) => {
    table.string('primary_connector_id').nullable();
    table.string('language').nullable();
    table.string('sample_dataset').nullable();
    table.string('recommendation_query_id').nullable();
    table.string('recommendation_status').nullable();
    table.jsonb('recommendation_questions').nullable();
    table.jsonb('recommendation_error').nullable();

    table
      .foreign('primary_connector_id')
      .references('id')
      .inTable('connector')
      .onDelete('SET NULL');
    table.index(['primary_connector_id']);
  });

  await knex.raw(`
    UPDATE knowledge_base AS kb
    SET primary_connector_id = scoped.connector_id
    FROM (
      SELECT knowledge_base_id, MIN(id) AS connector_id
      FROM connector
      WHERE knowledge_base_id IS NOT NULL
      GROUP BY knowledge_base_id
      HAVING COUNT(*) = 1
    ) AS scoped
    WHERE kb.id = scoped.knowledge_base_id
      AND kb.primary_connector_id IS NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('knowledge_base', (table) => {
    table.dropIndex(['primary_connector_id']);
    table.dropForeign(['primary_connector_id']);
    table.dropColumn('primary_connector_id');
    table.dropColumn('language');
    table.dropColumn('sample_dataset');
    table.dropColumn('recommendation_query_id');
    table.dropColumn('recommendation_status');
    table.dropColumn('recommendation_questions');
    table.dropColumn('recommendation_error');
  });
};
