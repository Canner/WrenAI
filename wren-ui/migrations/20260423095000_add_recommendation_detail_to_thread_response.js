/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasRecommendationDetail = await knex.schema.hasColumn(
    'thread_response',
    'recommendation_detail',
  );

  await knex.schema.alterTable('thread_response', (table) => {
    if (!hasRecommendationDetail) {
      table
        .jsonb('recommendation_detail')
        .nullable()
        .comment('Persisted recommendation follow-up payload');
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasRecommendationDetail = await knex.schema.hasColumn(
    'thread_response',
    'recommendation_detail',
  );

  await knex.schema.alterTable('thread_response', (table) => {
    if (hasRecommendationDetail) {
      table.dropColumn('recommendation_detail');
    }
  });
};
