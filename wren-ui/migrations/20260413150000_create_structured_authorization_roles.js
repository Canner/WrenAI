const crypto = require('crypto');

const PLATFORM_SCOPE_ID = '';

const permissions = [
  ['workspace.create', 'platform', 'Create a new workspace'],
  ['workspace.read', 'workspace', 'Read workspace metadata'],
  ['workspace.default.set', 'workspace', 'Set personal default workspace'],
  ['workspace.member.invite', 'workspace', 'Invite a workspace member'],
  [
    'workspace.member.approve',
    'workspace',
    'Approve a workspace join request',
  ],
  ['workspace.member.reject', 'workspace', 'Reject a workspace join request'],
  [
    'workspace.member.status.update',
    'workspace',
    'Update a workspace member status',
  ],
  ['workspace.member.remove', 'workspace', 'Remove a workspace member'],
  [
    'workspace.member.role.update',
    'workspace',
    'Change a workspace member role',
  ],
  ['workspace.schedule.manage', 'workspace', 'Manage workspace schedules'],
  ['dashboard.schedule.manage', 'workspace', 'Manage dashboard schedules'],
  ['knowledge_base.create', 'workspace', 'Create a knowledge base'],
  ['knowledge_base.read', 'workspace', 'Read a knowledge base'],
  ['knowledge_base.update', 'workspace', 'Update a knowledge base'],
  [
    'knowledge_base.archive',
    'workspace',
    'Archive or restore a knowledge base',
  ],
  ['connector.create', 'workspace', 'Create a connector'],
  ['connector.read', 'workspace', 'Read connector details'],
  ['connector.update', 'workspace', 'Update a connector'],
  ['connector.delete', 'workspace', 'Delete a connector'],
  [
    'connector.rotate_secret',
    'workspace',
    'Rotate or replace connector secrets',
  ],
  ['skill.create', 'workspace', 'Create a skill'],
  ['skill.read', 'workspace', 'Read skill details'],
  ['skill.update', 'workspace', 'Update a skill'],
  ['skill.delete', 'workspace', 'Delete a skill'],
  ['secret.reencrypt', 'workspace', 'Re-encrypt workspace secrets'],
];

const roles = [
  ['platform_admin', 'platform', 'Platform administrator'],
  ['workspace_owner', 'workspace', 'Workspace owner'],
  ['workspace_admin', 'workspace', 'Workspace administrator'],
  ['workspace_viewer', 'workspace', 'Workspace viewer'],
];

const rolePermissions = {
  platform_admin: ['workspace.create'],
  workspace_owner: [
    'workspace.read',
    'workspace.default.set',
    'workspace.member.invite',
    'workspace.member.approve',
    'workspace.member.reject',
    'workspace.member.status.update',
    'workspace.member.remove',
    'workspace.member.role.update',
    'workspace.schedule.manage',
    'dashboard.schedule.manage',
    'knowledge_base.create',
    'knowledge_base.read',
    'knowledge_base.update',
    'knowledge_base.archive',
    'connector.create',
    'connector.read',
    'connector.update',
    'connector.delete',
    'connector.rotate_secret',
    'skill.create',
    'skill.read',
    'skill.update',
    'skill.delete',
    'secret.reencrypt',
  ],
  workspace_admin: [
    'workspace.read',
    'workspace.default.set',
    'workspace.member.invite',
    'workspace.member.approve',
    'workspace.member.reject',
    'workspace.member.status.update',
    'workspace.member.remove',
    'workspace.member.role.update',
    'workspace.schedule.manage',
    'dashboard.schedule.manage',
    'knowledge_base.create',
    'knowledge_base.read',
    'knowledge_base.update',
    'knowledge_base.archive',
    'connector.create',
    'connector.read',
    'connector.update',
    'connector.delete',
    'connector.rotate_secret',
    'skill.create',
    'skill.read',
    'skill.update',
    'skill.delete',
    'secret.reencrypt',
  ],
  workspace_viewer: [
    'workspace.read',
    'workspace.default.set',
    'knowledge_base.read',
    'connector.read',
    'skill.read',
  ],
};

const workspaceRoleNameByLegacyRole = {
  owner: 'workspace_owner',
  admin: 'workspace_admin',
  member: 'workspace_viewer',
};

const buildIdMap = (rows, keyField) =>
  rows.reduce((acc, row) => {
    acc[row[keyField]] = row.id;
    return acc;
  }, {});

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('role', (table) => {
    table.string('id').primary();
    table.string('name').notNullable().unique();
    table.string('scope_type').notNullable();
    table.text('description').nullable();
    table.boolean('is_system').notNullable().defaultTo(true);
    table.string('created_by').nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable('permission', (table) => {
    table.string('id').primary();
    table.string('name').notNullable().unique();
    table.string('scope_type').notNullable();
    table.text('description').nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable('role_permission', (table) => {
    table.string('id').primary();
    table.string('role_id').notNullable().references('id').inTable('role').onDelete('CASCADE');
    table
      .string('permission_id')
      .notNullable()
      .references('id')
      .inTable('permission')
      .onDelete('CASCADE');
    table.unique(['role_id', 'permission_id'], 'role_permission_role_permission_unique');
    table.index(['role_id'], 'role_permission_role_idx');
    table.index(['permission_id'], 'role_permission_permission_idx');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('principal_role_binding', (table) => {
    table.string('id').primary();
    table.string('principal_type').notNullable();
    table.string('principal_id').notNullable();
    table.string('role_id').notNullable().references('id').inTable('role').onDelete('CASCADE');
    table.string('scope_type').notNullable();
    table.string('scope_id').notNullable().defaultTo(PLATFORM_SCOPE_ID);
    table.string('created_by').nullable();
    table.unique(
      ['principal_type', 'principal_id', 'scope_type', 'scope_id', 'role_id'],
      'principal_role_binding_unique',
    );
    table.index(
      ['principal_type', 'principal_id', 'scope_type', 'scope_id'],
      'principal_role_binding_scope_idx',
    );
    table.timestamps(true, true);
  });

  await knex('permission')
    .insert(
      permissions.map(([name, scopeType, description]) => ({
        id: crypto.randomUUID(),
        name,
        scope_type: scopeType,
        description,
      })),
    )
    .onConflict('name')
    .ignore();

  await knex('role')
    .insert(
      roles.map(([name, scopeType, description]) => ({
        id: crypto.randomUUID(),
        name,
        scope_type: scopeType,
        description,
        is_system: true,
      })),
    )
    .onConflict('name')
    .ignore();

  const permissionRows = await knex('permission').select('id', 'name');
  const roleRows = await knex('role').select('id', 'name');
  const permissionIdByName = buildIdMap(permissionRows, 'name');
  const roleIdByName = buildIdMap(roleRows, 'name');

  const rolePermissionRows = Object.entries(rolePermissions).flatMap(
    ([roleName, permissionNames]) =>
      permissionNames
        .map((permissionName) => ({
          id: crypto.randomUUID(),
          role_id: roleIdByName[roleName],
          permission_id: permissionIdByName[permissionName],
        }))
        .filter((row) => row.role_id && row.permission_id),
  );

  if (rolePermissionRows.length > 0) {
    await knex('role_permission')
      .insert(rolePermissionRows)
      .onConflict(['role_id', 'permission_id'])
      .ignore();
  }

  const activeMemberships = await knex('workspace_member')
    .select('workspace_id', 'user_id', 'role_key')
    .where({ status: 'active' });

  const workspaceBindingRows = activeMemberships
    .map((membership) => {
      const roleName =
        workspaceRoleNameByLegacyRole[
          String(membership.role_key || '').trim().toLowerCase()
        ];
      const roleId = roleIdByName[roleName];
      if (!roleId) {
        return null;
      }

      return {
        id: crypto.randomUUID(),
        principal_type: 'user',
        principal_id: membership.user_id,
        role_id: roleId,
        scope_type: 'workspace',
        scope_id: membership.workspace_id,
        created_by: membership.user_id,
      };
    })
    .filter(Boolean);

  if (workspaceBindingRows.length > 0) {
    await knex('principal_role_binding')
      .insert(workspaceBindingRows)
      .onConflict([
        'principal_type',
        'principal_id',
        'scope_type',
        'scope_id',
        'role_id',
      ])
      .ignore();
  }

  const platformAdminRoleId = roleIdByName.platform_admin;
  if (platformAdminRoleId) {
    const platformAdmins = await knex('user')
      .select('id')
      .where({ is_platform_admin: true });
    const platformBindingRows = platformAdmins.map((user) => ({
      id: crypto.randomUUID(),
      principal_type: 'user',
      principal_id: user.id,
      role_id: platformAdminRoleId,
      scope_type: 'platform',
      scope_id: PLATFORM_SCOPE_ID,
      created_by: user.id,
    }));

    if (platformBindingRows.length > 0) {
      await knex('principal_role_binding')
        .insert(platformBindingRows)
        .onConflict([
          'principal_type',
          'principal_id',
          'scope_type',
          'scope_id',
          'role_id',
        ])
        .ignore();
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('principal_role_binding');
  await knex.schema.dropTableIfExists('role_permission');
  await knex.schema.dropTableIfExists('permission');
  await knex.schema.dropTableIfExists('role');
};
