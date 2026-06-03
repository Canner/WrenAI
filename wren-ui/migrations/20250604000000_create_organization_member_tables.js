/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('organization_members', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').notNullable();
    table.integer('user_id').notNullable();
    table.string('organization_role', 80).notNullable();
    table.timestamps(true, true);

    table
      .foreign('organization_id')
      .references('organization.id')
      .onDelete('CASCADE');
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.unique(['organization_id', 'user_id']);
  });

  await knex.schema.createTable('organization_member_projects', (table) => {
    table.increments('id').primary();
    table.integer('organization_member_id').notNullable();
    table.integer('project_id').notNullable();
    table.string('permission', 80).notNullable();
    table.timestamps(true, true);

    table
      .foreign('organization_member_id')
      .references('organization_members.id')
      .onDelete('CASCADE');
    table.foreign('project_id').references('project.id').onDelete('CASCADE');
    table.unique(['organization_member_id', 'project_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('organization_member_projects');
  await knex.schema.dropTableIfExists('organization_members');
};
