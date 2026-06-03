/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasUsers = await knex.schema.hasTable('users');
  const hasRoles = await knex.schema.hasTable('roles');

  if (hasUsers) {
    const hasPasswordHash = await knex.schema.hasColumn(
      'users',
      'password_hash',
    );
    const hasLastLoginAt = await knex.schema.hasColumn(
      'users',
      'last_login_at',
    );
    await knex.schema.alterTable('users', (table) => {
      if (!hasPasswordHash) {
        table.string('password_hash', 255).nullable();
      }
      if (!hasLastLoginAt) {
        table.timestamp('last_login_at').nullable();
      }
    });
  }

  const hasOrganizations = await knex.schema.hasTable('organizations');
  if (!hasOrganizations) {
    await knex.schema.createTable('organizations', (table) => {
      table.increments('id').primary();
      table.string('name', 160).notNullable().unique();
      table.string('slug', 180).notNullable().unique();
      table.string('external_id', 255).nullable().unique();
      table.string('identity_provider', 80).nullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);
    });
  }

  const hasOrganizationMembers = await knex.schema.hasTable(
    'organization_members',
  );
  if (!hasOrganizationMembers) {
    await knex.schema.createTable('organization_members', (table) => {
      table.increments('id').primary();
      table.integer('organization_id').notNullable();
      table.integer('user_id').notNullable();
      table.integer('role_id').notNullable();
      table.string('status', 40).notNullable().defaultTo('active');
      table.integer('invited_by_member_id').nullable();
      table.timestamp('joined_at').nullable();
      table.timestamps(true, true);

      table
        .foreign('organization_id')
        .references('organizations.id')
        .onDelete('CASCADE');
      table.foreign('user_id').references('users.id').onDelete('CASCADE');
      table.foreign('role_id').references('roles.id').onDelete('RESTRICT');
      table.unique(['organization_id', 'user_id']);
    });
  }

  const hasMemberInvitations = await knex.schema.hasTable('member_invitations');
  if (!hasMemberInvitations) {
    await knex.schema.createTable('member_invitations', (table) => {
      table.increments('id').primary();
      table.integer('organization_id').notNullable();
      table.integer('role_id').notNullable();
      table.string('email', 320).notNullable();
      table.string('name', 160).nullable();
      table.string('token', 128).notNullable().unique();
      table.string('status', 40).notNullable().defaultTo('pending');
      table.integer('invited_by_member_id').nullable();
      table.timestamp('expires_at').notNullable();
      table.timestamp('accepted_at').nullable();
      table.timestamps(true, true);

      table
        .foreign('organization_id')
        .references('organizations.id')
        .onDelete('CASCADE');
      table.foreign('role_id').references('roles.id').onDelete('RESTRICT');
      table.unique(['organization_id', 'email', 'status']);
    });
  }

  const hasAuthSessions = await knex.schema.hasTable('auth_sessions');
  if (!hasAuthSessions) {
    await knex.schema.createTable('auth_sessions', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable();
      table.integer('organization_member_id').notNullable();
      table.string('token', 128).notNullable().unique();
      table.timestamp('expires_at').notNullable();
      table.timestamp('revoked_at').nullable();
      table.timestamps(true, true);

      table.foreign('user_id').references('users.id').onDelete('CASCADE');
      table
        .foreign('organization_member_id')
        .references('organization_members.id')
        .onDelete('CASCADE');
    });
  }

  if (hasOrganizations || !hasUsers || !hasRoles) return;

  const now = new Date().toISOString();
  const [organization] = await knex('organizations')
    .insert({
      name: 'Default organization',
      slug: 'default',
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    .returning('*');

  const adminRole = await knex('roles').where({ name: 'Admin' }).first();
  const roles = await knex('roles');
  const users = await knex('users');
  const userRoles = await knex('user_roles');

  const roleById = new Map(roles.map((role) => [role.id, role]));
  const firstRoleByUserId = new Map();
  userRoles.forEach((mapping) => {
    if (!firstRoleByUserId.has(mapping.user_id)) {
      firstRoleByUserId.set(mapping.user_id, mapping.role_id);
    }
  });

  for (const user of users) {
    const roleId = firstRoleByUserId.get(user.id) || adminRole?.id;
    if (!roleById.has(roleId)) continue;
    await knex('organization_members').insert({
      organization_id: organization.id,
      user_id: user.id,
      role_id: roleId,
      status: 'active',
      joined_at: now,
      created_at: now,
      updated_at: now,
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('auth_sessions');
  await knex.schema.dropTableIfExists('member_invitations');
  await knex.schema.dropTableIfExists('organization_members');
  await knex.schema.dropTableIfExists('organizations');

  const hasUsers = await knex.schema.hasTable('users');
  if (hasUsers) {
    const hasPasswordHash = await knex.schema.hasColumn(
      'users',
      'password_hash',
    );
    const hasLastLoginAt = await knex.schema.hasColumn(
      'users',
      'last_login_at',
    );
    await knex.schema.alterTable('users', (table) => {
      if (hasPasswordHash) table.dropColumn('password_hash');
      if (hasLastLoginAt) table.dropColumn('last_login_at');
    });
  }
};
