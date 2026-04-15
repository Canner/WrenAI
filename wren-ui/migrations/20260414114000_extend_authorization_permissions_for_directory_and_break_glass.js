const crypto = require('crypto');

const permissions = [
  ['group.read', 'workspace', 'Read directory group bindings'],
  ['group.manage', 'workspace', 'Manage directory groups and role bindings'],
  ['break_glass.manage', 'platform', 'Manage emergency break-glass grants'],
];

const rolePermissions = {
  platform_admin: ['break_glass.manage'],
  workspace_owner: ['group.read', 'group.manage'],
  workspace_admin: ['group.read', 'group.manage'],
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
    await knex('permission')
      .whereIn(
        'name',
        permissions.map(([name]) => name),
      )
      .delete();
  }
};
