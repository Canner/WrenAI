const crypto = require('crypto');

const WORKSPACE_SCOPE_ID = '';

const permissions = [
  ['audit.read', 'workspace', 'Read workspace audit events'],
  ['role.read', 'workspace', 'Read workspace role catalog and bindings'],
  ['role.manage', 'workspace', 'Manage custom workspace roles and bindings'],
];

const rolePermissions = {
  workspace_owner: ['audit.read', 'role.read', 'role.manage'],
  workspace_admin: ['audit.read', 'role.read', 'role.manage'],
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('role', (table) => {
    table.string('scope_id').notNullable().defaultTo(WORKSPACE_SCOPE_ID);
    table.string('display_name').nullable();
  });

  await knex.schema.alterTable('role', (table) => {
    table.index(['scope_type', 'scope_id'], 'role_scope_idx');
  });

  await knex('role')
    .whereNull('scope_id')
    .orWhere('scope_id', '')
    .update({
      scope_id: WORKSPACE_SCOPE_ID,
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

  await knex.schema.alterTable('role', (table) => {
    table.dropIndex(['scope_type', 'scope_id'], 'role_scope_idx');
    table.dropColumn('scope_id');
    table.dropColumn('display_name');
  });
};
