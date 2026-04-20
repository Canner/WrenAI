import crypto from 'crypto';
import {
  getCustomRoleAssignableActions,
  isAuthorizationAction,
} from './permissionRegistry';
import {
  buildCustomRoleName,
  getWorkspaceRoleKey,
  isCustomWorkspaceRole,
  isRoleVisibleInWorkspace,
  normalizeCustomRoleKey,
  normalizeRoleDisplayName,
} from './adminCatalogHelpers';
import { Role } from '@server/repositories';
import type { BindingCatalogDeps, RoleCatalogDeps } from './adminCatalogTypes';

export const createCustomWorkspaceRole = async ({
  workspaceId,
  name,
  displayName,
  description,
  isActive,
  permissionNames,
  createdBy,
  roleRepository,
  permissionRepository,
  rolePermissionRepository,
}: Pick<
  RoleCatalogDeps,
  'roleRepository' | 'permissionRepository' | 'rolePermissionRepository'
> & {
  workspaceId: string;
  name?: string | null;
  displayName: string;
  description?: string | null;
  isActive?: boolean;
  permissionNames: string[];
  createdBy?: string | null;
}) => {
  const normalizedDisplayName = String(displayName || '').trim();
  if (!normalizedDisplayName) {
    throw new Error('displayName is required');
  }
  const normalizedRoleKey = normalizeCustomRoleKey(
    name || normalizedDisplayName,
  );

  const assignableActions = new Set<string>(getCustomRoleAssignableActions());
  const uniquePermissionNames = Array.from(
    new Set(
      permissionNames.map((name) => String(name || '').trim()).filter(Boolean),
    ),
  );
  if (
    uniquePermissionNames.some(
      (permissionName) =>
        !isAuthorizationAction(permissionName) ||
        !assignableActions.has(permissionName),
    )
  ) {
    throw new Error('Custom role contains unsupported permissions');
  }

  const [roles, permissions] = await Promise.all([
    roleRepository.findAll(),
    permissionRepository.findAll(),
  ]);
  const workspaceRoles = roles.filter((role) =>
    isRoleVisibleInWorkspace(role, workspaceId),
  );
  const duplicateKey = workspaceRoles.find(
    (role) =>
      getWorkspaceRoleKey(role, workspaceId).toLowerCase() ===
      normalizedRoleKey.toLowerCase(),
  );
  if (duplicateKey) {
    throw new Error('Role key already exists in this workspace');
  }
  const duplicate = workspaceRoles.find(
    (role) =>
      normalizeRoleDisplayName(role).toLowerCase() ===
      normalizedDisplayName.toLowerCase(),
  );
  if (duplicate) {
    throw new Error('Role display name already exists in this workspace');
  }

  const permissionIdByName = new Map(
    permissions.map((permission) => [permission.name, permission.id]),
  );
  const missingPermission = uniquePermissionNames.find(
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
        name: buildCustomRoleName(
          workspaceId,
          normalizedRoleKey,
          new Set(roles.map((candidate) => candidate.name)),
        ),
        displayName: normalizedDisplayName,
        scopeType: 'workspace',
        scopeId: workspaceId,
        description: description || null,
        isSystem: false,
        isActive: isActive !== false,
        createdBy: createdBy || null,
      },
      { tx },
    );

    if (uniquePermissionNames.length > 0) {
      await rolePermissionRepository.createMany(
        uniquePermissionNames.map((permissionName) => ({
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

export const updateCustomWorkspaceRole = async ({
  workspaceId,
  roleId,
  name,
  displayName,
  description,
  isActive,
  permissionNames,
  roleRepository,
  permissionRepository,
  rolePermissionRepository,
}: Pick<
  RoleCatalogDeps,
  'roleRepository' | 'permissionRepository' | 'rolePermissionRepository'
> & {
  workspaceId: string;
  roleId: string;
  name?: string;
  displayName?: string;
  description?: string | null;
  isActive?: boolean;
  permissionNames?: string[];
}) => {
  const role = await roleRepository.findOneBy({ id: roleId });
  if (!role || !isRoleVisibleInWorkspace(role, workspaceId)) {
    throw new Error('Workspace role not found');
  }
  const metadataEditable = isCustomWorkspaceRole(role, workspaceId);

  const tx = await roleRepository.transaction();
  try {
    const patch: Partial<Role> = {};
    if (name !== undefined) {
      if (!metadataEditable) {
        throw new Error('System role metadata is immutable');
      }
      const normalizedRoleKey = normalizeCustomRoleKey(name);
      const roles = await roleRepository.findAll({ tx });
      const duplicate = roles.find(
        (candidate) =>
          candidate.id !== role.id &&
          isRoleVisibleInWorkspace(candidate, workspaceId) &&
          getWorkspaceRoleKey(candidate, workspaceId).toLowerCase() ===
            normalizedRoleKey.toLowerCase(),
      );
      if (duplicate) {
        throw new Error('Role key already exists in this workspace');
      }
      patch.name = buildCustomRoleName(
        workspaceId,
        normalizedRoleKey,
        new Set(
          roles
            .filter((candidate) => candidate.id !== role.id)
            .map((candidate) => candidate.name),
        ),
      );
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
          isRoleVisibleInWorkspace(candidate, workspaceId) &&
          normalizeRoleDisplayName(candidate).toLowerCase() ===
            normalizedDisplayName.toLowerCase(),
      );
      if (duplicate) {
        throw new Error('Role display name already exists in this workspace');
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

    const updated =
      Object.keys(patch).length > 0
        ? await roleRepository.updateOne(role.id, patch, { tx })
        : role;

    if (permissionNames) {
      const assignableActions = new Set<string>(
        getCustomRoleAssignableActions(),
      );
      const [permissions, existingRolePermissions] = await Promise.all([
        permissionRepository.findAll({ tx }),
        rolePermissionRepository.findAllBy({ roleId: role.id }, { tx }),
      ]);
      const permissionIdByName = new Map(
        permissions.map((permission) => [permission.name, permission.id]),
      );
      const permissionNameById = new Map(
        permissions.map((permission) => [permission.id, permission.name]),
      );
      const existingPermissionNames = existingRolePermissions
        .map((record) => permissionNameById.get(record.permissionId))
        .filter(Boolean) as string[];
      const allowedPermissionNames = metadataEditable
        ? assignableActions
        : new Set([...assignableActions, ...existingPermissionNames]);
      const uniquePermissionNames = Array.from(
        new Set(
          permissionNames
            .map((name) => String(name || '').trim())
            .filter(Boolean),
        ),
      );
      if (
        uniquePermissionNames.some(
          (permissionName) =>
            !isAuthorizationAction(permissionName) ||
            !allowedPermissionNames.has(permissionName),
        )
      ) {
        throw new Error('Custom role contains unsupported permissions');
      }
      const normalizedPermissionNames = metadataEditable
        ? uniquePermissionNames
        : Array.from(
            new Set([
              ...uniquePermissionNames,
              ...existingPermissionNames.filter(
                (permissionName) => !assignableActions.has(permissionName),
              ),
            ]),
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
    return updated;
  } catch (error) {
    await roleRepository.rollback(tx);
    throw error;
  }
};

export const deleteCustomWorkspaceRole = async ({
  workspaceId,
  roleId,
  roleRepository,
}: Pick<RoleCatalogDeps, 'roleRepository'> & {
  workspaceId: string;
  roleId: string;
}) => {
  const role = await roleRepository.findOneBy({ id: roleId });
  if (!role || !isCustomWorkspaceRole(role, workspaceId)) {
    throw new Error('Custom role not found');
  }

  await roleRepository.deleteOne(role.id);
  return role;
};

export const createWorkspaceRoleBinding = async ({
  workspaceId,
  principalType,
  principalId,
  roleId,
  createdBy,
  roleRepository,
  principalRoleBindingRepository,
  workspaceMemberRepository,
  directoryGroupRepository,
  serviceAccountRepository,
}: Pick<
  BindingCatalogDeps,
  | 'roleRepository'
  | 'principalRoleBindingRepository'
  | 'workspaceMemberRepository'
  | 'directoryGroupRepository'
  | 'serviceAccountRepository'
> & {
  workspaceId: string;
  principalType: 'user' | 'group' | 'service_account';
  principalId: string;
  roleId: string;
  createdBy?: string | null;
}) => {
  const role = await roleRepository.findOneBy({ id: roleId });
  if (!role || !isCustomWorkspaceRole(role, workspaceId)) {
    throw new Error('Only workspace custom roles can be bound here');
  }

  if (principalType === 'user') {
    const membership = await workspaceMemberRepository.findOneBy({
      userId: principalId,
      workspaceId,
    });
    if (!membership) {
      throw new Error('Target user is not a workspace member');
    }
  } else if (principalType === 'group') {
    const group = await directoryGroupRepository.findOneBy({ id: principalId });
    if (!group || group.workspaceId !== workspaceId) {
      throw new Error('Directory group not found');
    }
  } else {
    const serviceAccount = await serviceAccountRepository.findOneBy({
      id: principalId,
    });
    if (!serviceAccount || serviceAccount.workspaceId !== workspaceId) {
      throw new Error('Service account not found');
    }
  }

  const existingBindings = await principalRoleBindingRepository.findAllBy({
    principalType,
    principalId,
    scopeType: 'workspace',
    scopeId: workspaceId,
    roleId,
  });
  if (existingBindings.length > 0) {
    return existingBindings[0];
  }

  return principalRoleBindingRepository.createOne({
    id: crypto.randomUUID(),
    principalType,
    principalId,
    roleId,
    scopeType: 'workspace',
    scopeId: workspaceId,
    createdBy: createdBy || null,
  });
};

export const deleteWorkspaceRoleBinding = async ({
  workspaceId,
  bindingId,
  roleRepository,
  principalRoleBindingRepository,
}: Pick<
  RoleCatalogDeps,
  'roleRepository' | 'principalRoleBindingRepository'
> & {
  workspaceId: string;
  bindingId: string;
}) => {
  const binding = await principalRoleBindingRepository.findOneBy({
    id: bindingId,
  });
  if (
    !binding ||
    binding.scopeType !== 'workspace' ||
    binding.scopeId !== workspaceId
  ) {
    throw new Error('Role binding not found');
  }
  const role = await roleRepository.findOneBy({ id: binding.roleId });
  if (!role || !isCustomWorkspaceRole(role, workspaceId)) {
    throw new Error('Only custom role bindings can be removed here');
  }

  await principalRoleBindingRepository.deleteOne(binding.id);
  return { binding, role };
};
