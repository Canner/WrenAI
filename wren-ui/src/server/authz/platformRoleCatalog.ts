import crypto from 'crypto';
import type { RoleCatalogDeps } from './adminCatalogTypes';
import {
  AUTHORIZATION_ACTIONS,
  getAuthorizationActionMeta,
  isAuthorizationAction,
} from './permissionRegistry';
import { normalizeRoleDisplayName } from './adminCatalogHelpers';
import { PLATFORM_ADMIN_ROLE_NAME, PLATFORM_SCOPE_ID } from './roleMapping';
import { ensureAuthorizationCatalogSeeded } from './systemAuthorizationCatalog';
import type { Role } from '@server/repositories';

export type PlatformPermissionCatalogItem = {
  name: string;
  description: string;
  scope: 'platform';
};

export type PlatformRoleCatalogItem = {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  scopeType: string;
  scopeId?: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionNames: string[];
  bindingCount: number;
};

const normalizeRoleKey = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

const getPlatformAuthorizationActions = () =>
  (Object.keys(AUTHORIZATION_ACTIONS) as Array<keyof typeof AUTHORIZATION_ACTIONS>)
    .filter((action) => getAuthorizationActionMeta(action).scope === 'platform');

const getPlatformAssignableActions = () => new Set(getPlatformAuthorizationActions());

const isPlatformRole = (role: Role) =>
  role.scopeType === 'platform' && String(role.scopeId || '') === PLATFORM_SCOPE_ID;

const ensureValidPlatformPermissionNames = (permissionNames: string[]) => {
  const assignableActions = getPlatformAssignableActions();
  const normalizedPermissionNames = Array.from(
    new Set(permissionNames.map((name) => String(name || '').trim()).filter(Boolean)),
  );

  if (
    normalizedPermissionNames.some(
      (permissionName) =>
        !isAuthorizationAction(permissionName) || !assignableActions.has(permissionName),
    )
  ) {
    throw new Error('Platform role contains unsupported permissions');
  }

  return normalizedPermissionNames;
};

export const listPlatformRoleCatalog = async ({
  roleRepository,
  permissionRepository,
  rolePermissionRepository,
  principalRoleBindingRepository,
}: RoleCatalogDeps) => {
  await ensureAuthorizationCatalogSeeded({
    roleRepository,
    permissionRepository,
    rolePermissionRepository,
  });

  const [roles, permissions, rolePermissions, bindings] = await Promise.all([
    roleRepository.findAll({ order: 'is_system desc, created_at asc' }),
    permissionRepository.findAll({ order: 'name asc' }),
    rolePermissionRepository.findAll(),
    principalRoleBindingRepository.findAllBy({
      scopeType: 'platform',
      scopeId: PLATFORM_SCOPE_ID,
    }),
  ]);

  const permissionNameById = new Map(
    permissions.map((permission) => [permission.id, permission.name]),
  );
  const permissionNamesByRoleId = rolePermissions.reduce<Record<string, string[]>>(
    (acc, rolePermission) => {
      const permissionName = permissionNameById.get(rolePermission.permissionId);
      if (!permissionName) {
        return acc;
      }
      acc[rolePermission.roleId] = acc[rolePermission.roleId] || [];
      acc[rolePermission.roleId].push(permissionName);
      return acc;
    },
    {},
  );
  const bindingCountByRoleId = bindings.reduce<Record<string, number>>(
    (acc, binding) => {
      acc[binding.roleId] = (acc[binding.roleId] || 0) + 1;
      return acc;
    },
    {},
  );

  const permissionCatalog: PlatformPermissionCatalogItem[] = permissions
    .filter((permission) => permission.scopeType === 'platform')
    .map((permission) => ({
      name: permission.name,
      description: permission.description || '',
      scope: 'platform',
    }));

  const roleItems: PlatformRoleCatalogItem[] = roles
    .filter(isPlatformRole)
    .map((role) => ({
      id: role.id,
      name: role.name,
      displayName: normalizeRoleDisplayName(role),
      description: role.description || null,
      scopeType: role.scopeType,
      scopeId: role.scopeId || PLATFORM_SCOPE_ID,
      isSystem: Boolean(role.isSystem),
      isActive: role.isActive !== false,
      permissionNames: Array.from(
        new Set(permissionNamesByRoleId[role.id] || []),
      ).sort(),
      bindingCount: bindingCountByRoleId[role.id] || 0,
    }))
    .sort((left, right) => {
      if (left.isSystem !== right.isSystem) {
        return left.isSystem ? -1 : 1;
      }
      return left.displayName.localeCompare(right.displayName);
    });

  return {
    roles: roleItems,
    permissionCatalog,
  };
};

export const createCustomPlatformRole = async ({
  name,
  displayName,
  description,
  isActive,
  permissionNames,
  createdBy,
  roleRepository,
  permissionRepository,
  rolePermissionRepository,
}: Omit<RoleCatalogDeps, 'principalRoleBindingRepository'> & {
  name: string;
  displayName: string;
  description?: string | null;
  isActive?: boolean;
  permissionNames: string[];
  createdBy?: string | null;
}) => {
  const normalizedName = normalizeRoleKey(name);
  const normalizedDisplayName = String(displayName || '').trim();
  if (!normalizedName) {
    throw new Error('name is required');
  }
  if (!normalizedDisplayName) {
    throw new Error('displayName is required');
  }

  const normalizedPermissionNames =
    ensureValidPlatformPermissionNames(permissionNames);

  await ensureAuthorizationCatalogSeeded({
    roleRepository,
    permissionRepository,
    rolePermissionRepository,
  });

  const [roles, permissions] = await Promise.all([
    roleRepository.findAll(),
    permissionRepository.findAll(),
  ]);
  const platformRoles = roles.filter(isPlatformRole);
  const duplicateName = platformRoles.find(
    (role) => String(role.name || '').toLowerCase() === normalizedName,
  );
  if (duplicateName) {
    throw new Error('Platform role key already exists');
  }
  const duplicateDisplayName = platformRoles.find(
    (role) =>
      normalizeRoleDisplayName(role).toLowerCase() ===
      normalizedDisplayName.toLowerCase(),
  );
  if (duplicateDisplayName) {
    throw new Error('Platform role display name already exists');
  }

  const permissionIdByName = new Map(
    permissions.map((permission) => [permission.name, permission.id]),
  );
  const missingPermission = normalizedPermissionNames.find(
    (permissionName) => !permissionIdByName.has(permissionName),
  );
  if (missingPermission) {
    throw new Error(`Permission ${missingPermission} is not registered`);
  }

  const tx = await roleRepository.transaction();
  try {
    const role = await roleRepository.createOne(
      {
        id: crypto.randomUUID(),
        name: normalizedName,
        displayName: normalizedDisplayName,
        scopeType: 'platform',
        scopeId: PLATFORM_SCOPE_ID,
        description: description || null,
        isSystem: false,
        isActive: isActive !== false,
        createdBy: createdBy || null,
      },
      { tx },
    );

    if (normalizedPermissionNames.length > 0) {
      await rolePermissionRepository.createMany(
        normalizedPermissionNames.map((permissionName) => ({
          id: crypto.randomUUID(),
          roleId: role.id,
          permissionId: permissionIdByName.get(permissionName)!,
        })),
        { tx },
      );
    }

    await roleRepository.commit(tx);
    return role;
  } catch (error) {
    await roleRepository.rollback(tx);
    throw error;
  }
};

export const updatePlatformRole = async ({
  roleId,
  name,
  displayName,
  description,
  isActive,
  permissionNames,
  roleRepository,
  permissionRepository,
  rolePermissionRepository,
}: Omit<RoleCatalogDeps, 'principalRoleBindingRepository'> & {
  roleId: string;
  name?: string;
  displayName?: string;
  description?: string | null;
  isActive?: boolean;
  permissionNames?: string[];
}) => {
  await ensureAuthorizationCatalogSeeded({
    roleRepository,
    permissionRepository,
    rolePermissionRepository,
  });

  const role = await roleRepository.findOneBy({ id: roleId });
  if (!role || !isPlatformRole(role)) {
    throw new Error('Platform role not found');
  }
  const metadataEditable = !role.isSystem;

  const tx = await roleRepository.transaction();
  try {
    const patch: Partial<Role> = {};
    if (name !== undefined) {
      if (!metadataEditable) {
        throw new Error('System role metadata is immutable');
      }
      const normalizedName = normalizeRoleKey(name);
      if (!normalizedName) {
        throw new Error('name is required');
      }
      const roles = await roleRepository.findAll({ tx });
      const duplicate = roles.find(
        (candidate) =>
          candidate.id !== role.id &&
          isPlatformRole(candidate) &&
          String(candidate.name || '').toLowerCase() === normalizedName,
      );
      if (duplicate) {
        throw new Error('Platform role key already exists');
      }
      patch.name = normalizedName;
    }

    if (displayName !== undefined) {
      if (!metadataEditable) {
        throw new Error('System role metadata is immutable');
      }
      const normalizedDisplayName = String(displayName || '').trim();
      if (!normalizedDisplayName) {
        throw new Error('displayName is required');
      }
      const roles = await roleRepository.findAll({ tx });
      const duplicate = roles.find(
        (candidate) =>
          candidate.id !== role.id &&
          isPlatformRole(candidate) &&
          normalizeRoleDisplayName(candidate).toLowerCase() ===
            normalizedDisplayName.toLowerCase(),
      );
      if (duplicate) {
        throw new Error('Platform role display name already exists');
      }
      patch.displayName = normalizedDisplayName;
    }

    if (description !== undefined) {
      if (!metadataEditable) {
        throw new Error('System role metadata is immutable');
      }
      patch.description = description || null;
    }

    if (isActive !== undefined) {
      if (!metadataEditable) {
        throw new Error('System role metadata is immutable');
      }
      patch.isActive = Boolean(isActive);
    }

    const updatedRole =
      Object.keys(patch).length > 0
        ? await roleRepository.updateOne(role.id, patch, { tx })
        : role;

    if (permissionNames !== undefined) {
      const normalizedPermissionNames =
        ensureValidPlatformPermissionNames(permissionNames);
      const permissions = await permissionRepository.findAll({ tx });
      const permissionIdByName = new Map(
        permissions.map((permission) => [permission.name, permission.id]),
      );
      const missingPermission = normalizedPermissionNames.find(
        (permissionName) => !permissionIdByName.has(permissionName),
      );
      if (missingPermission) {
        throw new Error(`Permission ${missingPermission} is not registered`);
      }

      await rolePermissionRepository.deleteAllBy({ roleId: role.id }, { tx });
      if (normalizedPermissionNames.length > 0) {
        await rolePermissionRepository.createMany(
          normalizedPermissionNames.map((permissionName) => ({
            id: crypto.randomUUID(),
            roleId: role.id,
            permissionId: permissionIdByName.get(permissionName)!,
          })),
          { tx },
        );
      }
    }

    await roleRepository.commit(tx);
    return updatedRole;
  } catch (error) {
    await roleRepository.rollback(tx);
    throw error;
  }
};

export const deletePlatformRole = async ({
  roleId,
  roleRepository,
}: Pick<RoleCatalogDeps, 'roleRepository'> & {
  roleId: string;
}) => {
  const role = await roleRepository.findOneBy({ id: roleId });
  if (!role || !isPlatformRole(role)) {
    throw new Error('Platform role not found');
  }
  if (role.isSystem || role.name === PLATFORM_ADMIN_ROLE_NAME) {
    throw new Error('System platform role cannot be deleted');
  }

  await roleRepository.deleteOne(role.id);
  return role;
};
