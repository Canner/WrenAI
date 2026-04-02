/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('secret_record', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('scope_type').notNullable();
    table.string('scope_id').notNullable();
    table.text('ciphertext').notNullable();
    table.text('iv').notNullable();
    table.text('auth_tag').notNullable();
    table.text('aad').nullable();
    table.integer('key_version').notNullable().defaultTo(1);
    table.string('created_by').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table.index(['workspace_id', 'scope_type']);
    table.index(['scope_type', 'scope_id']);
  });

  await knex.schema.createTable('connector', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('knowledge_base_id').nullable();
    table.string('type').notNullable();
    table.string('display_name').notNullable();
    table.jsonb('config_json').nullable();
    table.string('secret_record_id').nullable();
    table.string('created_by').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table
      .foreign('knowledge_base_id')
      .references('id')
      .inTable('knowledge_base')
      .onDelete('CASCADE');
    table
      .foreign('secret_record_id')
      .references('id')
      .inTable('secret_record')
      .onDelete('SET NULL');
    table.index(['workspace_id']);
    table.index(['knowledge_base_id']);
  });

  await knex.schema.createTable('skill_definition', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('name').notNullable();
    table.string('runtime_kind').notNullable().defaultTo('isolated_python');
    table.string('source_type').notNullable().defaultTo('inline');
    table.text('source_ref').nullable();
    table.string('entrypoint').nullable();
    table.jsonb('manifest_json').nullable();
    table.string('created_by').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table.unique(['workspace_id', 'name']);
    table.index(['workspace_id']);
  });

  await knex.schema.createTable('skill_binding', (table) => {
    table.string('id').primary();
    table.string('knowledge_base_id').notNullable();
    table.string('kb_snapshot_id').nullable();
    table.string('skill_definition_id').notNullable();
    table.string('connector_id').nullable();
    table.jsonb('binding_config').nullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.string('created_by').nullable();
    table.timestamps(true, true);

    table
      .foreign('knowledge_base_id')
      .references('id')
      .inTable('knowledge_base')
      .onDelete('CASCADE');
    table
      .foreign('kb_snapshot_id')
      .references('id')
      .inTable('kb_snapshot')
      .onDelete('SET NULL');
    table
      .foreign('skill_definition_id')
      .references('id')
      .inTable('skill_definition')
      .onDelete('CASCADE');
    table
      .foreign('connector_id')
      .references('id')
      .inTable('connector')
      .onDelete('SET NULL');
    table.index(['knowledge_base_id']);
    table.index(['kb_snapshot_id']);
  });

  await knex.schema.createTable('schedule_job', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('knowledge_base_id').notNullable();
    table.string('kb_snapshot_id').notNullable();
    table.string('deploy_hash').notNullable();
    table.string('target_type').notNullable();
    table.string('target_id').notNullable();
    table.text('cron_expr').notNullable();
    table.string('timezone').notNullable();
    table.string('status').notNullable().defaultTo('active');
    table.timestamp('next_run_at').nullable();
    table.timestamp('last_run_at').nullable();
    table.text('last_error').nullable();
    table.string('created_by').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table
      .foreign('knowledge_base_id')
      .references('id')
      .inTable('knowledge_base')
      .onDelete('CASCADE');
    table
      .foreign('kb_snapshot_id')
      .references('id')
      .inTable('kb_snapshot')
      .onDelete('CASCADE');
    table.index(['status', 'next_run_at']);
    table.index(['workspace_id', 'knowledge_base_id']);
  });

  await knex.schema.createTable('schedule_job_run', (table) => {
    table.string('id').primary();
    table.string('schedule_job_id').notNullable();
    table.string('trace_id').nullable();
    table.string('status').notNullable();
    table.timestamp('started_at').nullable();
    table.timestamp('finished_at').nullable();
    table.text('error_message').nullable();
    table.jsonb('detail_json').nullable();
    table.timestamps(true, true);

    table
      .foreign('schedule_job_id')
      .references('id')
      .inTable('schedule_job')
      .onDelete('CASCADE');
    table.index(['schedule_job_id', 'created_at']);
    table.index(['status']);
  });

  await knex.schema.createTable('audit_event', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('actor_user_id').nullable();
    table.string('entity_type').notNullable();
    table.string('entity_id').notNullable();
    table.string('event_type').notNullable();
    table.jsonb('payload_json').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table
      .foreign('actor_user_id')
      .references('id')
      .inTable('user')
      .onDelete('SET NULL');
    table.index(['workspace_id', 'created_at']);
    table.index(['entity_type', 'entity_id']);
    table.index(['event_type']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_event');
  await knex.schema.dropTableIfExists('schedule_job_run');
  await knex.schema.dropTableIfExists('schedule_job');
  await knex.schema.dropTableIfExists('skill_binding');
  await knex.schema.dropTableIfExists('skill_definition');
  await knex.schema.dropTableIfExists('connector');
  await knex.schema.dropTableIfExists('secret_record');
};
