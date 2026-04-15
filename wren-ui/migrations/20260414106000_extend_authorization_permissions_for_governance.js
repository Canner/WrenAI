const crypto = require('crypto');

const permissions = [
  ['service_account.read', 'workspace', 'Read service account details'],
  ['service_account.create', 'workspace', 'Create a service account'],
  ['service_account.update', 'workspace', 'Update a service account'],
  ['service_account.delete', 'workspace', 'Delete a service account'],
  ['api_token.read', 'workspace', 'Read API token metadata'],
  ['api_token.create', 'workspace', 'Create an API token'],
  ['api_token.revoke', 'workspace', 'Revoke an API token'],
  ['identity_provider.read', 'workspace', 'Read identity provider settings'],
  ['identity_provider.manage', 'workspace', 'Manage identity provider settings'],
  ['access_review.read', 'workspace', 'Read workspace access reviews'],
  ['access_review.manage', 'workspace', 'Manage workspace access reviews'],
  ['impersonation.start', 'platform', 'Start an audited impersonation session'],
];

const rolePermissions = {
  platform_admin: ['impersonation.start'],
  workspace_owner: [
    'service_account.read',
    'service_account.create',
    'service_account.update',
    'service_account.delete',
    'api_token.read',
    'api_token.create',
    'api_token.revoke',
    'identity_provider.read',
    'identity_provider.manage',
    'access_review.read',
    'access_review.manage',
  ],
  workspace_admin: [
    'service_account.read',
    'service_account.create',
    'service_account.update',
    'service_account.delete',
    'api_token.read',
    'api_token.create',
    'api_token.revoke',
    'identity_provider.read',
    'identity_provider.manage',
    'access_review.read',
    'access_review.manage',
  ],
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
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

  const permissionRows = await knex('permission').select('id', 'name');
  const roleRows = await knex('role').select('id', 'name');
  const permissionIdByName = permissionRows.reduce((acc, row) => {
    acc[row.name] = row.id;
    return acc;
  }, {});
  const roleIdByName = roleRows.reduce((acc, row) => {
    acc[row.name] = row.id;
    return acc;
  }, {});

  const rows = Object.entries(rolePermissions).flatMap(
    ([roleName, permissionNames]) =>
      permissionNames
        .map((permissionName) => ({
          id: crypto.randomUUID(),
          role_id: roleIdByName[roleName],
          permission_id: permissionIdByName[permissionName],
        }))
        .filter((row) => row.role_id && row.permission_id),
  );

  if (rows.length > 0) {
    await knex('role_permission')
      .insert(rows)
      .onConflict(['role_id', 'permission_id'])
      .ignore();
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const permissionRows = await knex('permission')
    .select('id')
    .whereIn(
      'name',
      permissions.map(([name]) => name),
    );
  const permissionIds = permissionRows.map((row) => row.id);

  if (permissionIds.length > 0) {
    await knex('role_permission').whereIn('permission_id', permissionIds).delete();
    await knex('permission').whereIn(
      'name',
      permissions.map(([name]) => name),
    ).delete();
  }
};
