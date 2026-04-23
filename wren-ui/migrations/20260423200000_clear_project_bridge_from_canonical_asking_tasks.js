exports.up = async function (knex) {
  const hasAskingTaskTable = await knex.schema.hasTable('asking_task');
  const hasThreadTable = await knex.schema.hasTable('thread');
  const hasThreadResponseTable = await knex.schema.hasTable('thread_response');

  if (!hasAskingTaskTable) {
    return;
  }

  if (hasThreadResponseTable) {
    await knex.raw(`
      UPDATE asking_task AS at
      SET
        workspace_id = COALESCE(at.workspace_id, tr.workspace_id),
        knowledge_base_id = COALESCE(at.knowledge_base_id, tr.knowledge_base_id),
        kb_snapshot_id = COALESCE(at.kb_snapshot_id, tr.kb_snapshot_id),
        deploy_hash = COALESCE(at.deploy_hash, tr.deploy_hash),
        actor_user_id = COALESCE(at.actor_user_id, tr.actor_user_id)
      FROM thread_response AS tr
      WHERE tr.id = at.thread_response_id
        AND (
          (at.workspace_id IS NULL AND tr.workspace_id IS NOT NULL)
          OR (at.knowledge_base_id IS NULL AND tr.knowledge_base_id IS NOT NULL)
          OR (at.kb_snapshot_id IS NULL AND tr.kb_snapshot_id IS NOT NULL)
          OR (at.deploy_hash IS NULL AND tr.deploy_hash IS NOT NULL)
          OR (at.actor_user_id IS NULL AND tr.actor_user_id IS NOT NULL)
        )
    `);
  }

  if (hasThreadTable) {
    await knex.raw(`
      UPDATE asking_task AS at
      SET
        workspace_id = COALESCE(at.workspace_id, t.workspace_id),
        knowledge_base_id = COALESCE(at.knowledge_base_id, t.knowledge_base_id),
        kb_snapshot_id = COALESCE(at.kb_snapshot_id, t.kb_snapshot_id),
        deploy_hash = COALESCE(at.deploy_hash, t.deploy_hash),
        actor_user_id = COALESCE(at.actor_user_id, t.actor_user_id)
      FROM thread AS t
      WHERE t.id = at.thread_id
        AND (
          (at.workspace_id IS NULL AND t.workspace_id IS NOT NULL)
          OR (at.knowledge_base_id IS NULL AND t.knowledge_base_id IS NOT NULL)
          OR (at.kb_snapshot_id IS NULL AND t.kb_snapshot_id IS NOT NULL)
          OR (at.deploy_hash IS NULL AND t.deploy_hash IS NOT NULL)
          OR (at.actor_user_id IS NULL AND t.actor_user_id IS NOT NULL)
        )
    `);
  }

  await knex('asking_task')
    .whereNotNull('project_id')
    .andWhere((builder) => {
      builder
        .whereNotNull('workspace_id')
        .orWhereNotNull('knowledge_base_id')
        .orWhereNotNull('kb_snapshot_id')
        .orWhereNotNull('deploy_hash');
    })
    .update({
      project_id: null,
    });
};

exports.down = async function () {
  // Irreversible data cleanup: canonical-bound asking tasks no longer retain
  // compatibility-scope project bridges.
};
