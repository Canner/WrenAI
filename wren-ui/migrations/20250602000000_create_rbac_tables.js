/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('roles', (table) => {
    table.increments('id').primary();
    table.string('name', 80).notNullable().unique();
    table
      .text('description')
      .nullable()
      .comment('Human-readable role purpose and future governance notes');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('name', 160).notNullable();
    table.string('email', 320).notNullable().unique();
    table.string('external_id', 255).nullable().unique();
    table.string('identity_provider', 80).nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('user_roles', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable();
    table.integer('role_id').notNullable();
    table.timestamps(true, true);

    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('role_id').references('roles.id').onDelete('CASCADE');
    table.unique(['user_id', 'role_id']);
  });

  const now = new Date().toISOString();
  await knex('roles').insert([
    {
      name: 'Admin',
      description: 'Full administration access foundation role.',
      created_at: now,
      updated_at: now,
    },
    {
      name: 'Manager',
      description:
        'Manages users, assignments, and future governance workflows.',
      created_at: now,
      updated_at: now,
    },
    {
      name: 'Analyst',
      description: 'Creates and analyzes project content.',
      created_at: now,
      updated_at: now,
    },
    {
      name: 'Viewer',
      description:
        'Read-only foundation role for future permission enforcement.',
      created_at: now,
      updated_at: now,
    },
  ]);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('roles');
};
