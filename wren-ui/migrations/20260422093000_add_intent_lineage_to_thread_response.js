/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasResolvedIntent = await knex.schema.hasColumn(
    'thread_response',
    'resolved_intent',
  );
  const hasArtifactLineage = await knex.schema.hasColumn(
    'thread_response',
    'artifact_lineage',
  );

  await knex.schema.alterTable('thread_response', (table) => {
    if (!hasResolvedIntent) {
      table
        .jsonb('resolved_intent')
        .nullable()
        .comment('Persisted resolved home intent metadata');
    }
    if (!hasArtifactLineage) {
      table
        .jsonb('artifact_lineage')
        .nullable()
        .comment('Persisted response artifact lineage metadata');
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasResolvedIntent = await knex.schema.hasColumn(
    'thread_response',
    'resolved_intent',
  );
  const hasArtifactLineage = await knex.schema.hasColumn(
    'thread_response',
    'artifact_lineage',
  );

  await knex.schema.alterTable('thread_response', (table) => {
    if (hasArtifactLineage) {
      table.dropColumn('artifact_lineage');
    }
    if (hasResolvedIntent) {
      table.dropColumn('resolved_intent');
    }
  });
};
