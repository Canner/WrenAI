/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('knowledge_base', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('slug').notNullable();
    table.string('name').notNullable();
    table.text('description').nullable();
    table.string('default_kb_snapshot_id').nullable();
    table.string('created_by').nullable();
    table.timestamp('archived_at').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table.unique(['workspace_id', 'slug']);
    table.index(['workspace_id']);
  });

  await knex.schema.createTable('kb_snapshot', (table) => {
    table.string('id').primary();
    table.string('knowledge_base_id').notNullable();
    table.string('snapshot_key').notNullable();
    table.string('display_name').notNullable();
    table.string('environment').nullable();
    table.string('version_label').nullable();
    table.string('deploy_hash').notNullable();
    table.jsonb('manifest_ref').nullable();
    table.integer('legacy_project_id').nullable();
    table.string('status').notNullable().defaultTo('active');
    table.timestamps(true, true);

    table
      .foreign('knowledge_base_id')
      .references('id')
      .inTable('knowledge_base')
      .onDelete('CASCADE');
    table.unique(['knowledge_base_id', 'snapshot_key']);
    table.unique(['knowledge_base_id', 'deploy_hash']);
    table.index(['knowledge_base_id', 'status']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('kb_snapshot');
  await knex.schema.dropTableIfExists('knowledge_base');
};
