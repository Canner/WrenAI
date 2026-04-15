/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('service_account', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('name').notNullable();
    table.text('description').nullable();
    table.string('role_key').notNullable().defaultTo('admin');
    table.string('status').notNullable().defaultTo('active');
    table.string('created_by').nullable();
    table.timestamp('last_used_at').nullable();
    table.jsonb('metadata').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table.foreign('created_by').references('id').inTable('user').onDelete('SET NULL');
    table.unique(['workspace_id', 'name']);
    table.index(['workspace_id', 'status']);
  });

  await knex.schema.createTable('api_token', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('service_account_id').nullable();
    table.string('user_id').nullable();
    table.string('name').notNullable();
    table.string('prefix').notNullable();
    table.text('token_hash').notNullable().unique();
    table.string('scope_type').notNullable().defaultTo('workspace');
    table.string('scope_id').notNullable();
    table.timestamp('expires_at').nullable();
    table.timestamp('revoked_at').nullable();
    table.timestamp('last_used_at').nullable();
    table.string('status').notNullable().defaultTo('active');
    table.string('created_by').nullable();
    table.jsonb('metadata').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table
      .foreign('service_account_id')
      .references('id')
      .inTable('service_account')
      .onDelete('CASCADE');
    table.foreign('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.foreign('created_by').references('id').inTable('user').onDelete('SET NULL');
    table.index(['workspace_id', 'status']);
    table.index(['service_account_id']);
    table.index(['user_id']);
    table.index(['expires_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('api_token');
  await knex.schema.dropTableIfExists('service_account');
};
