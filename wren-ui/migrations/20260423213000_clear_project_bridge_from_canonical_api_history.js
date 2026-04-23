exports.up = async function (knex) {
  const hasApiHistoryTable = await knex.schema.hasTable('api_history');

  if (!hasApiHistoryTable) {
    return;
  }

  await knex('api_history')
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
  // Irreversible data cleanup: canonical-bound API history no longer retains
  // compatibility-scope project bridges.
};
