/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('thread', (table) => {
    table.jsonb('knowledge_base_ids').nullable();
  });

  const rows = await knex('thread').select('id', 'knowledge_base_id');
  for (const row of rows) {
    const nextKnowledgeBaseIds = row.knowledge_base_id
      ? [row.knowledge_base_id]
      : [];

    await knex('thread')
      .where({ id: row.id })
      .update({
        knowledge_base_ids:
          nextKnowledgeBaseIds.length > 0
            ? JSON.stringify(nextKnowledgeBaseIds)
            : null,
      });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('thread', (table) => {
    table.dropColumn('knowledge_base_ids');
  });
};
