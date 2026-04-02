/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('workspace', (table) => {
    table.string('id').primary();
    table.string('slug').notNullable().unique();
    table.string('name').notNullable();
    table.string('status').notNullable().defaultTo('active');
    table.jsonb('settings').nullable();
    table.string('created_by').nullable();
    table.timestamps(true, true);

    table.index(['status']);
  });

  await knex.schema.createTable('user', (table) => {
    table.string('id').primary();
    table.string('email').notNullable().unique();
    table.string('display_name').notNullable();
    table.string('locale').nullable();
    table.string('status').notNullable().defaultTo('active');
    table.timestamp('last_login_at').nullable();
    table.timestamps(true, true);

    table.index(['status']);
  });

  await knex.schema.createTable('auth_identity', (table) => {
    table.string('id').primary();
    table.string('user_id').notNullable();
    table.string('provider_type').notNullable();
    table.string('provider_subject').notNullable();
    table.text('password_hash').nullable();
    table.string('password_algo').nullable();
    table.timestamp('email_verified_at').nullable();
    table.jsonb('metadata').nullable();
    table.timestamps(true, true);

    table.foreign('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.unique(['provider_type', 'provider_subject']);
    table.index(['user_id']);
  });

  await knex.schema.createTable('identity_provider_config', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('provider_type').notNullable();
    table.string('name').notNullable();
    table.boolean('enabled').notNullable().defaultTo(false);
    table.jsonb('config_json').nullable();
    table.string('created_by').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table.index(['workspace_id']);
    table.unique(['workspace_id', 'name']);
  });

  await knex.schema.createTable('auth_session', (table) => {
    table.string('id').primary();
    table.string('user_id').notNullable();
    table.string('auth_identity_id').notNullable();
    table.text('session_token_hash').notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.timestamp('revoked_at').nullable();
    table.timestamp('last_seen_at').nullable();
    table.string('ip_address').nullable();
    table.text('user_agent').nullable();
    table.timestamps(true, true);

    table.foreign('user_id').references('id').inTable('user').onDelete('CASCADE');
    table
      .foreign('auth_identity_id')
      .references('id')
      .inTable('auth_identity')
      .onDelete('CASCADE');
    table.index(['user_id']);
    table.index(['expires_at']);
  });

  await knex.schema.createTable('workspace_member', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('user_id').notNullable();
    table.string('role_key').notNullable().defaultTo('member');
    table.string('status').notNullable().defaultTo('active');
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table.foreign('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.unique(['workspace_id', 'user_id']);
    table.index(['workspace_id', 'status']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('workspace_member');
  await knex.schema.dropTableIfExists('auth_session');
  await knex.schema.dropTableIfExists('identity_provider_config');
  await knex.schema.dropTableIfExists('auth_identity');
  await knex.schema.dropTableIfExists('user');
  await knex.schema.dropTableIfExists('workspace');
};
