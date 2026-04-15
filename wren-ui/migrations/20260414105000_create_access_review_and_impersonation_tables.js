/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('auth_session', (table) => {
    table.string('impersonator_user_id').nullable();
    table.text('impersonation_reason').nullable();

    table
      .foreign('impersonator_user_id')
      .references('id')
      .inTable('user')
      .onDelete('SET NULL');
    table.index(['impersonator_user_id'], 'auth_session_impersonator_idx');
  });

  await knex.schema.createTable('access_review', (table) => {
    table.string('id').primary();
    table.string('workspace_id').notNullable();
    table.string('title').notNullable();
    table.string('status').notNullable().defaultTo('open');
    table.string('created_by').nullable();
    table.string('completed_by').nullable();
    table.timestamp('started_at').nullable();
    table.timestamp('completed_at').nullable();
    table.timestamp('due_at').nullable();
    table.text('notes').nullable();
    table.timestamps(true, true);

    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table.foreign('created_by').references('id').inTable('user').onDelete('SET NULL');
    table
      .foreign('completed_by')
      .references('id')
      .inTable('user')
      .onDelete('SET NULL');
    table.index(['workspace_id', 'status'], 'access_review_workspace_status_idx');
  });

  await knex.schema.createTable('access_review_item', (table) => {
    table.string('id').primary();
    table.string('access_review_id').notNullable();
    table.string('workspace_id').notNullable();
    table.string('workspace_member_id').nullable();
    table.string('user_id').nullable();
    table.string('role_key').nullable();
    table.string('status').notNullable().defaultTo('pending');
    table.string('decision').nullable();
    table.string('reviewed_by').nullable();
    table.timestamp('reviewed_at').nullable();
    table.text('notes').nullable();
    table.timestamps(true, true);

    table
      .foreign('access_review_id')
      .references('id')
      .inTable('access_review')
      .onDelete('CASCADE');
    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table
      .foreign('workspace_member_id')
      .references('id')
      .inTable('workspace_member')
      .onDelete('SET NULL');
    table.foreign('user_id').references('id').inTable('user').onDelete('SET NULL');
    table.foreign('reviewed_by').references('id').inTable('user').onDelete('SET NULL');
    table.index(
      ['access_review_id', 'status'],
      'access_review_item_review_status_idx',
    );
    table.index(['workspace_id', 'decision'], 'access_review_item_workspace_decision_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('access_review_item');
  await knex.schema.dropTableIfExists('access_review');

  await knex.schema.alterTable('auth_session', (table) => {
    table.dropIndex(['impersonator_user_id'], 'auth_session_impersonator_idx');
    table.dropColumn('impersonator_user_id');
    table.dropColumn('impersonation_reason');
  });
};
