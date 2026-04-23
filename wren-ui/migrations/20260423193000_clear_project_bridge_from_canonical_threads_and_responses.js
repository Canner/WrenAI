exports.up = async function (knex) {
  const hasThreadTable = await knex.schema.hasTable('thread');
  const hasThreadResponseTable = await knex.schema.hasTable('thread_response');

  if (!hasThreadTable || !hasThreadResponseTable) {
    return;
  }

  await knex.raw(`
    UPDATE thread_response AS tr
    SET
      workspace_id = COALESCE(tr.workspace_id, t.workspace_id),
      knowledge_base_id = COALESCE(tr.knowledge_base_id, t.knowledge_base_id),
      kb_snapshot_id = COALESCE(tr.kb_snapshot_id, t.kb_snapshot_id),
      deploy_hash = COALESCE(tr.deploy_hash, t.deploy_hash),
      actor_user_id = COALESCE(tr.actor_user_id, t.actor_user_id)
    FROM thread AS t
    WHERE t.id = tr.thread_id
      AND (
        (tr.workspace_id IS NULL AND t.workspace_id IS NOT NULL)
        OR (tr.knowledge_base_id IS NULL AND t.knowledge_base_id IS NOT NULL)
        OR (tr.kb_snapshot_id IS NULL AND t.kb_snapshot_id IS NOT NULL)
        OR (tr.deploy_hash IS NULL AND t.deploy_hash IS NOT NULL)
        OR (tr.actor_user_id IS NULL AND t.actor_user_id IS NOT NULL)
      )
  `);

  await knex('thread')
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

  await knex('thread_response')
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
  // Irreversible data cleanup: canonical-bound thread history no longer retains
  // compatibility-scope project bridges.
};
