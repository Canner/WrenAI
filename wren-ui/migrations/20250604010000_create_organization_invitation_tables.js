/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('organization_invitations', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').notNullable();
    table.integer('invited_by_user_id').nullable();
    table.string('email', 255).notNullable();
    table.string('organization_role', 80).notNullable();
    table.string('token', 255).notNullable().unique();
    table.string('status', 40).notNullable().defaultTo('Pending');
    table.timestamp('expires_at').notNullable();
    table.timestamp('accepted_at').nullable();
    table.timestamps(true, true);

    table
      .foreign('organization_id')
      .references('organization.id')
      .onDelete('CASCADE');
    table
      .foreign('invited_by_user_id')
      .references('users.id')
      .onDelete('SET NULL');
  });

  await knex.schema.createTable('organization_invitation_projects', (table) => {
    table.increments('id').primary();
    table.integer('organization_invitation_id').notNullable();
    table.integer('project_id').notNullable();
    table.string('permission', 80).notNullable();
    table.timestamps(true, true);

    table
      .foreign('organization_invitation_id')
      .references('organization_invitations.id')
      .onDelete('CASCADE');
    table.foreign('project_id').references('project.id').onDelete('CASCADE');
    table.unique(['organization_invitation_id', 'project_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('organization_invitation_projects');
  await knex.schema.dropTableIfExists('organization_invitations');
};
