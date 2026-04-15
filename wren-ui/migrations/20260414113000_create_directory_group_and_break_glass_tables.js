const crypto = require('crypto');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('directory_group', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('identity_provider_config_id').nullable();
    table.string('external_id').nullable();
    table.string('display_name').notNullable();
    table.string('source').notNullable().defaultTo('manual');
    table.string('status').notNullable().defaultTo('active');
    table.jsonb('metadata').nullable();
    table.string('created_by').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table
      .foreign('identity_provider_config_id')
      .references('id')
      .inTable('identity_provider_config')
      .onDelete('SET NULL');
    table.foreign('created_by').references('id').inTable('user').onDelete('SET NULL');
    table.unique(['workspace_id', 'display_name'], 'directory_group_workspace_name_unique');
    table.unique(
      ['workspace_id', 'identity_provider_config_id', 'external_id'],
      'directory_group_workspace_provider_external_unique',
    );
    table.index(['workspace_id', 'status'], 'directory_group_workspace_status_idx');
  });

  await knex.schema.createTable('directory_group_member', (table) => {
    table.string('id').primary();
    table.string('directory_group_id').notNullable();
    table.string('workspace_id').notNullable();
    table.string('user_id').notNullable();
    table.string('source').notNullable().defaultTo('manual');
    table.timestamps(true, true);

    table
      .foreign('directory_group_id')
      .references('id')
      .inTable('directory_group')
      .onDelete('CASCADE');
    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table.foreign('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.unique(
      ['directory_group_id', 'user_id'],
      'directory_group_member_group_user_unique',
    );
    table.index(['workspace_id', 'user_id'], 'directory_group_member_workspace_user_idx');
  });

  await knex.schema.createTable('break_glass_grant', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('user_id').notNullable();
    table.string('role_key').notNullable().defaultTo('owner');
    table.string('status').notNullable().defaultTo('active');
    table.text('reason').notNullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('revoked_at').nullable();
    table.string('created_by').nullable();
    table.string('revoked_by').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table.foreign('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.foreign('created_by').references('id').inTable('user').onDelete('SET NULL');
    table.foreign('revoked_by').references('id').inTable('user').onDelete('SET NULL');
    table.index(['workspace_id', 'status'], 'break_glass_grant_workspace_status_idx');
    table.index(['user_id', 'expires_at'], 'break_glass_grant_user_expiry_idx');
  });

  await knex.schema.alterTable('sso_session', (table) => {
    table.string('provider_request_id').nullable();
    table.jsonb('provider_state_json').nullable();
    table.index(['provider_request_id'], 'sso_session_provider_request_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('sso_session', (table) => {
    table.dropIndex(['provider_request_id'], 'sso_session_provider_request_idx');
    table.dropColumn('provider_request_id');
    table.dropColumn('provider_state_json');
  });

  await knex.schema.dropTableIfExists('break_glass_grant');
  await knex.schema.dropTableIfExists('directory_group_member');
  await knex.schema.dropTableIfExists('directory_group');
};
