exports.up = async function (knex) {
  const hasDashboardTable = await knex.schema.hasTable('dashboard');
  if (!hasDashboardTable) {
    return;
  }

  await knex('dashboard')
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
  // Irreversible data cleanup: canonical-bound dashboards no longer retain
  // compatibility-scope project bridges.
};
