exports.up = async function (knex) {
  await knex.schema.alterTable('deploy_log', (table) => {
    table.integer('project_id').nullable().alter();
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

  await knex.raw(`
    UPDATE deploy_log AS dl
    SET
      deploy_hash = COALESCE(dl.deploy_hash, dl.hash),
      kb_snapshot_id = COALESCE(dl.kb_snapshot_id, ks.id),
      knowledge_base_id = COALESCE(dl.knowledge_base_id, ks.knowledge_base_id),
      workspace_id = COALESCE(dl.workspace_id, kb.workspace_id)
    FROM kb_snapshot AS ks
    JOIN knowledge_base AS kb ON kb.id = ks.knowledge_base_id
    WHERE ks.deploy_hash = dl.hash
      AND (
        dl.deploy_hash IS NULL OR
        dl.kb_snapshot_id IS NULL OR
        dl.knowledge_base_id IS NULL OR
        dl.workspace_id IS NULL
      )
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('deploy_log', (table) => {
    table.dropIndex(['project_id']);
    table.dropIndex(['workspace_id']);
    table.dropIndex(['knowledge_base_id']);
    table.dropIndex(['kb_snapshot_id']);
    table.dropIndex(['deploy_hash']);
    table.dropIndex(['actor_user_id']);

    table.dropColumn('workspace_id');
    table.dropColumn('knowledge_base_id');
    table.dropColumn('kb_snapshot_id');
    table.dropColumn('deploy_hash');
    table.dropColumn('actor_user_id');
  });
};
