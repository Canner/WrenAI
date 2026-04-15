/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('auth_identity', (table) => {
    table.string('identity_provider_config_id').nullable();
    table.string('issuer').nullable();
    table.string('external_subject').nullable();

    table
      .foreign('identity_provider_config_id')
      .references('id')
      .inTable('identity_provider_config')
      .onDelete('SET NULL');
    table.unique(
      ['identity_provider_config_id', 'external_subject'],
      'auth_identity_provider_subject_unique',
    );
    table.index(['identity_provider_config_id'], 'auth_identity_provider_idx');
  });

  await knex.schema.createTable('sso_session', (table) => {
    table.string('id').primary();
    table.string('state').notNullable().unique();
    table.string('workspace_id').notNullable();
    table.string('identity_provider_config_id').notNullable();
    table.text('redirect_to').nullable();
    table.text('code_verifier').notNullable();
    table.string('nonce').notNullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('consumed_at').nullable();
    table.text('ip_address').nullable();
    table.text('user_agent').nullable();
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
      .onDelete('CASCADE');
    table.index(['workspace_id', 'expires_at'], 'sso_session_workspace_expiry_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('sso_session');

  await knex.schema.alterTable('auth_identity', (table) => {
    table.dropIndex(['identity_provider_config_id'], 'auth_identity_provider_idx');
    table.dropUnique(
      ['identity_provider_config_id', 'external_subject'],
      'auth_identity_provider_subject_unique',
    );
    table.dropColumn('identity_provider_config_id');
    table.dropColumn('issuer');
    table.dropColumn('external_subject');
  });
};
