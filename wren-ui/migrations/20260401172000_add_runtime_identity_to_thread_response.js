/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('thread_response', (table) => {
    table.integer('project_id').nullable();
    table.string('workspace_id').nullable();
    table.string('knowledge_base_id').nullable();
    table.string('kb_snapshot_id').nullable();
    table.string('deploy_hash').nullable();
    table.string('actor_user_id').nullable();

    table.index(['project_id']);
    table.index(['workspace_id']);
    table.index(['knowledge_base_id']);
    table.index(['kb_snapshot_id']);
    table.index(['deploy_hash']);
    table.index(['actor_user_id']);
  });

  const threadResponses = await knex('thread_response as tr')
    .leftJoin('thread as t', 't.id', 'tr.thread_id')
    .select(
      'tr.id',
      't.project_id as projectId',
      't.workspace_id as workspaceId',
      't.knowledge_base_id as knowledgeBaseId',
      't.kb_snapshot_id as kbSnapshotId',
      't.deploy_hash as deployHash',
      't.actor_user_id as actorUserId',
    );

  for (const response of threadResponses) {
    await knex('thread_response').where({ id: response.id }).update({
      project_id: response.projectId || null,
      workspace_id: response.workspaceId || null,
      knowledge_base_id: response.knowledgeBaseId || null,
      kb_snapshot_id: response.kbSnapshotId || null,
      deploy_hash: response.deployHash || null,
      actor_user_id: response.actorUserId || null,
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('thread_response', (table) => {
    table.dropIndex(['project_id']);
    table.dropIndex(['workspace_id']);
    table.dropIndex(['knowledge_base_id']);
    table.dropIndex(['kb_snapshot_id']);
    table.dropIndex(['deploy_hash']);
    table.dropIndex(['actor_user_id']);

    table.dropColumn('project_id');
    table.dropColumn('workspace_id');
    table.dropColumn('knowledge_base_id');
    table.dropColumn('kb_snapshot_id');
    table.dropColumn('deploy_hash');
    table.dropColumn('actor_user_id');
  });
};
