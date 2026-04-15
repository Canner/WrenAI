import crypto from 'crypto';
import { AuthorizationResource, authorize } from './authorize';
import { PLATFORM_SCOPE_ID, toLegacyWorkspaceRoleKeys } from './roleMapping';
import {
  AuthorizationAction,
  getCustomRoleAssignableActions,
  getWorkspaceAuthorizationActions,
  isAuthorizationAction,
} from './permissionRegistry';
import {
  IAuditEventRepository,
  AuditEventSearchInput,
  IDirectoryGroupMemberRepository,
  IDirectoryGroupRepository,
  IPermissionRepository,
  IPrincipalRoleBindingRepository,
  IRolePermissionRepository,
  IRoleRepository,
  IServiceAccountRepository,
  IUserRepository,
  IWorkspaceMemberRepository,
  Role,
} from '@server/repositories';

type RoleCatalogDeps = {
  roleRepository: IRoleRepository;
  permissionRepository: IPermissionRepository;
  rolePermissionRepository: IRolePermissionRepository;
  principalRoleBindingRepository: IPrincipalRoleBindingRepository;
};

type BindingCatalogDeps = RoleCatalogDeps & {
  userRepository: IUserRepository;
  workspaceMemberRepository: IWorkspaceMemberRepository;
  directoryGroupRepository: IDirectoryGroupRepository;
  serviceAccountRepository: IServiceAccountRepository;
  directoryGroupMemberRepository: IDirectoryGroupMemberRepository;
};

const SYSTEM_ROLE_LABELS: Record<string, string> = {
  workspace_owner: '所有者',
  workspace_admin: '管理员',
  workspace_viewer: '查看者',
  platform_admin: '平台管理员',
};

const CUSTOM_ROLE_PREFIX = 'workspace_custom_role';

export type WorkspaceRoleCatalogItem = {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  scopeType: string;
  scopeId?: string | null;
  isSystem: boolean;
  permissionNames: string[];
  bindingCount: number;
};

export type WorkspaceRoleBindingItem = {
  id: string;
  principalType: string;
  principalId: string;
  principalLabel: string;
  roleId: string;
  roleName: string;
  roleDisplayName: string;
  isSystem: boolean;
  createdBy?: string | null;
  createdAt?: Date | string | null;
};

const normalizeRoleDisplayName = (role: Role) =>
  String(
    role.displayName ||
      SYSTEM_ROLE_LABELS[String(role.name || '').trim().toLowerCase()] ||
      role.name,
  );

const isRoleVisibleInWorkspace = (role: Role, workspaceId: string) =>
  role.scopeType === 'workspace' &&
  (!role.scopeId || role.scopeId === '' || role.scopeId === workspaceId);

const isCustomWorkspaceRole = (role: Role, workspaceId: string) =>
  !role.isSystem && role.scopeType === 'workspace' && role.scopeId === workspaceId;

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

const buildCustomRoleName = (
  workspaceId: string,
  displayName: string,
  existingNames: Set<string>,
) => {
  const baseSlug = slugify(displayName) || 'custom_role';
  let candidate = `${CUSTOM_ROLE_PREFIX}:${workspaceId}:${baseSlug}`;
  let sequence = 2;
  while (existingNames.has(candidate)) {
    candidate = `${CUSTOM_ROLE_PREFIX}:${workspaceId}:${baseSlug}_${sequence}`;
    sequence += 1;
  }
  return candidate;
};

const buildPermissionMap = async ({
  permissionRepository,
  rolePermissionRepository,
}: Pick<RoleCatalogDeps, 'permissionRepository' | 'rolePermissionRepository'>) => {
  const [permissions, rolePermissions] = await Promise.all([
    permissionRepository.findAll(),
    rolePermissionRepository.findAll(),
  ]);
  const permissionNameById = new Map(
    permissions.map((permission) => [permission.id, permission.name]),
  );
  const permissionCatalog = permissions
    .filter((permission) => permission.scopeType === 'workspace')
    .map((permission) => ({
      name: permission.name,
      description: permission.description || '',
      assignable: getCustomRoleAssignableActions().includes(
        permission.name as AuthorizationAction,
      ),
    }));
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

  return { permissionCatalog, permissionNamesByRoleId, permissions };
};

export const listWorkspaceRoleCatalog = async ({
  workspaceId,
  roleRepository,
  permissionRepository,
  rolePermissionRepository,
  principalRoleBindingRepository,
}: RoleCatalogDeps & { workspaceId: string }) => {
  const [roles, bindings, permissionData] = await Promise.all([
    roleRepository.findAll({ order: 'is_system desc, created_at asc' }),
    principalRoleBindingRepository.findAllBy({
      scopeType: 'workspace',
      scopeId: workspaceId,
    }),
    buildPermissionMap({ permissionRepository, rolePermissionRepository }),
  ]);

  const bindingCountByRoleId = bindings.reduce<Record<string, number>>(
    (acc, binding) => {
      acc[binding.roleId] = (acc[binding.roleId] || 0) + 1;
      return acc;
    },
    {},
  );

  const roleItems: WorkspaceRoleCatalogItem[] = roles
    .filter((role) => isRoleVisibleInWorkspace(role, workspaceId))
    .map((role) => ({
      id: role.id,
      name: role.name,
      displayName: normalizeRoleDisplayName(role),
      description: role.description || null,
      scopeType: role.scopeType,
      scopeId: role.scopeId || '',
      isSystem: Boolean(role.isSystem),
      permissionNames: Array.from(
        new Set(permissionData.permissionNamesByRoleId[role.id] || []),
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
    permissionCatalog: permissionData.permissionCatalog,
    actionCatalog: getWorkspaceAuthorizationActions().map((name) => ({
      name,
      description: permissionData.permissions.find(
        (permission) => permission.name === name,
      )?.description || '',
    })),
  };
};

const buildPrincipalLabel = async ({
  principalType,
  principalId,
  userRepository,
  workspaceMemberRepository,
  directoryGroupRepository,
  serviceAccountRepository,
  workspaceId,
}: {
  principalType: string;
  principalId: string;
  workspaceId: string;
} & Pick<
  BindingCatalogDeps,
  | 'userRepository'
  | 'workspaceMemberRepository'
  | 'directoryGroupRepository'
  | 'serviceAccountRepository'
>) => {
  if (principalType === 'user') {
    const [user, membership] = await Promise.all([
      userRepository.findOneBy({ id: principalId }),
      workspaceMemberRepository.findOneBy({
        userId: principalId,
        workspaceId,
      }),
    ]);
    const name = user?.displayName || user?.email || principalId;
    return membership?.roleKey ? `${name} · ${membership.roleKey}` : name;
  }

  if (principalType === 'group') {
    const group = await directoryGroupRepository.findOneBy({ id: principalId });
    return group?.displayName || principalId;
  }

  if (principalType === 'service_account') {
    const serviceAccount = await serviceAccountRepository.findOneBy({
      id: principalId,
    });
    return serviceAccount?.name || principalId;
  }

  return principalId;
};

export const listWorkspaceRoleBindings = async ({
  workspaceId,
  roleRepository,
  principalRoleBindingRepository,
  userRepository,
  workspaceMemberRepository,
  directoryGroupRepository,
  serviceAccountRepository,
}: Omit<BindingCatalogDeps, 'permissionRepository' | 'rolePermissionRepository' | 'directoryGroupMemberRepository'> & {
  workspaceId: string;
}) => {
  const [bindings, roles] = await Promise.all([
    principalRoleBindingRepository.findAllBy({
      scopeType: 'workspace',
      scopeId: workspaceId,
    }),
    roleRepository.findAll(),
  ]);

  const roleById = new Map(roles.map((role) => [role.id, role]));
  const items = await Promise.all(
    bindings
      .map(async (binding) => {
        const role = roleById.get(binding.roleId);
        if (!role || !isRoleVisibleInWorkspace(role, workspaceId)) {
          return null;
        }

        return {
          id: binding.id,
          principalType: binding.principalType,
          principalId: binding.principalId,
          principalLabel: await buildPrincipalLabel({
            principalType: binding.principalType,
            principalId: binding.principalId,
            userRepository,
            workspaceMemberRepository,
            directoryGroupRepository,
            serviceAccountRepository,
            workspaceId,
          }),
          roleId: role.id,
          roleName: role.name,
          roleDisplayName: normalizeRoleDisplayName(role),
          isSystem: Boolean(role.isSystem),
          createdBy: binding.createdBy || null,
          createdAt: binding.createdAt || null,
        } satisfies WorkspaceRoleBindingItem;
      })
      .filter(Boolean),
  );

  return items
    .filter(Boolean)
    .sort((left, right) =>
      String(left!.roleDisplayName).localeCompare(String(right!.roleDisplayName)),
    ) as WorkspaceRoleBindingItem[];
};

export const createCustomWorkspaceRole = async ({
  workspaceId,
  displayName,
  description,
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
  displayName: string;
  description?: string | null;
  permissionNames: string[];
  createdBy?: string | null;
}) => {
  const normalizedDisplayName = String(displayName || '').trim();
  if (!normalizedDisplayName) {
    throw new Error('displayName is required');
  }

  const assignableActions = new Set(getCustomRoleAssignableActions());
  const uniquePermissionNames = Array.from(
    new Set(permissionNames.map((name) => String(name || '').trim()).filter(Boolean)),
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
  const workspaceRoles = roles.filter((role) => isRoleVisibleInWorkspace(role, workspaceId));
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
          normalizedDisplayName,
          new Set(roles.map((candidate) => candidate.name)),
        ),
        displayName: normalizedDisplayName,
        scopeType: 'workspace',
        scopeId: workspaceId,
        description: description || null,
        isSystem: false,
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
  displayName,
  description,
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
  displayName?: string;
  description?: string | null;
  permissionNames?: string[];
}) => {
  const role = await roleRepository.findOneBy({ id: roleId });
  if (!role || !isCustomWorkspaceRole(role, workspaceId)) {
    throw new Error('Custom role not found');
  }

  const tx = await roleRepository.transaction();
  try {
    const patch: Partial<Role> = {};
    if (displayName !== undefined) {
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
      patch.description = description || null;
    }

    const updated =
      Object.keys(patch).length > 0
        ? await roleRepository.updateOne(role.id, patch, { tx })
        : role;

    if (permissionNames) {
      const assignableActions = new Set(getCustomRoleAssignableActions());
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
            !assignableActions.has(permissionName),
        )
      ) {
        throw new Error('Custom role contains unsupported permissions');
      }
      const permissions = await permissionRepository.findAll({ tx });
      const permissionIdByName = new Map(
        permissions.map((permission) => [permission.name, permission.id]),
      );
      await rolePermissionRepository.deleteAllBy({ roleId: role.id }, { tx });
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
}: Pick<RoleCatalogDeps, 'roleRepository' | 'principalRoleBindingRepository'> & {
  workspaceId: string;
  bindingId: string;
}) => {
  const binding = await principalRoleBindingRepository.findOneBy({ id: bindingId });
  if (!binding || binding.scopeType !== 'workspace' || binding.scopeId !== workspaceId) {
    throw new Error('Role binding not found');
  }
  const role = await roleRepository.findOneBy({ id: binding.roleId });
  if (!role || !isCustomWorkspaceRole(role, workspaceId)) {
    throw new Error('Only custom role bindings can be removed here');
  }

  await principalRoleBindingRepository.deleteOne(binding.id);
  return { binding, role };
};

export const explainWorkspaceAuthorization = async ({
  workspaceId,
  principalType,
  principalId,
  action,
  resource,
  roleRepository,
  principalRoleBindingRepository,
  directoryGroupRepository,
  directoryGroupMemberRepository,
}: Pick<
  BindingCatalogDeps,
  | 'roleRepository'
  | 'principalRoleBindingRepository'
  | 'directoryGroupRepository'
  | 'directoryGroupMemberRepository'
> & {
  workspaceId: string;
  principalType: 'user' | 'group' | 'service_account';
  principalId: string;
  action?: string;
  resource?: AuthorizationResource | null;
}) => {
  const workspaceScope = {
    principalType,
    principalId,
    scopeType: 'workspace',
    scopeId: workspaceId,
  } as const;
  const [directBindings, directPermissions, allRoles] = await Promise.all([
    principalRoleBindingRepository.findResolvedRoleBindings(workspaceScope),
    principalRoleBindingRepository.findPermissionNamesByScope(workspaceScope),
    roleRepository.findAll(),
  ]);

  let groupBindings: Array<{ roleName: string; groupId: string; groupName: string }> =
    [];
  let groupPermissions: string[] = [];
  if (principalType === 'user') {
    const memberships = await directoryGroupMemberRepository.findAllByUser(
      workspaceId,
      principalId,
    );
    const groupIds = Array.from(
      new Set(memberships.map((membership) => membership.directoryGroupId)),
    );
    const groups = await Promise.all(
      groupIds.map((groupId) =>
        directoryGroupRepository.findOneBy({ id: groupId }),
      ),
    );
    const activeGroups = groups.filter(
      (group): group is NonNullable<typeof group> =>
        Boolean(group && group.workspaceId === workspaceId && group.status === 'active'),
    );
    const groupResults = await Promise.all(
      activeGroups.map(async (group) => {
        const scope = {
          principalType: 'group',
          principalId: group.id,
          scopeType: 'workspace',
          scopeId: workspaceId,
        } as const;
        const [bindings, permissions] = await Promise.all([
          principalRoleBindingRepository.findResolvedRoleBindings(scope),
          principalRoleBindingRepository.findPermissionNamesByScope(scope),
        ]);
        return {
          group,
          bindings,
          permissions,
        };
      }),
    );
    groupBindings = groupResults.flatMap((item) =>
      item.bindings.map((binding) => ({
        roleName: binding.roleName,
        groupId: item.group.id,
        groupName: item.group.displayName,
      })),
    );
    groupPermissions = Array.from(
      new Set(groupResults.flatMap((item) => item.permissions)),
    );
  }

  const [platformBindings, platformPermissions] =
    principalType === 'user'
      ? await Promise.all([
          principalRoleBindingRepository.findResolvedRoleBindings({
            principalType: 'user',
            principalId,
            scopeType: 'platform',
            scopeId: PLATFORM_SCOPE_ID,
          }),
          principalRoleBindingRepository.findPermissionNamesByScope({
            principalType: 'user',
            principalId,
            scopeType: 'platform',
            scopeId: PLATFORM_SCOPE_ID,
          }),
        ])
      : [[], []];

  const roleByName = new Map(allRoles.map((role) => [role.name, role]));
  const grantedActions = Array.from(
    new Set([...directPermissions, ...groupPermissions, ...platformPermissions]),
  );
  const workspaceRoleKeys = toLegacyWorkspaceRoleKeys([
    ...directBindings.map((binding) => binding.roleName),
    ...groupBindings.map((binding) => binding.roleName),
  ]);
  const platformRoleKeys = Array.from(
    new Set(
      platformBindings.map((binding) =>
        String(binding.roleName || '').trim().toLowerCase(),
      ),
    ),
  );

  const actor = {
    principalType,
    principalId,
    workspaceId,
    workspaceMemberId: null,
    workspaceRoleKeys,
    permissionScopes: rolePermissionsToScopes(grantedActions, workspaceId),
    isPlatformAdmin: platformRoleKeys.includes('platform_admin'),
    platformRoleKeys,
    grantedActions,
    workspaceRoleSource: 'role_binding' as const,
    platformRoleSource: platformBindings.length > 0 ? ('role_binding' as const) : undefined,
    sessionId: null,
  };

  const decision =
    action && isAuthorizationAction(action)
      ? authorize({
          actor,
          action,
          resource:
            resource || {
              resourceType: 'workspace',
              resourceId: workspaceId,
              workspaceId,
            },
        })
      : null;

  return {
    actor,
    directBindings: directBindings.map((binding) => ({
      roleName: binding.roleName,
      roleDisplayName: normalizeRoleDisplayName(
        roleByName.get(binding.roleName) || ({ name: binding.roleName } as Role),
      ),
    })),
    groupBindings: groupBindings.map((binding) => ({
      groupId: binding.groupId,
      groupName: binding.groupName,
      roleName: binding.roleName,
      roleDisplayName: normalizeRoleDisplayName(
        roleByName.get(binding.roleName) || ({ name: binding.roleName } as Role),
      ),
    })),
    platformBindings: platformBindings.map((binding) => ({
      roleName: binding.roleName,
      roleDisplayName: normalizeRoleDisplayName(
        roleByName.get(binding.roleName) || ({ name: binding.roleName } as Role),
      ),
    })),
    grantedActions,
    decision,
  };
};

const rolePermissionsToScopes = (grantedActions: string[], workspaceId: string) => {
  const scopes = new Set<string>();
  grantedActions.forEach((action) => {
    if (action === 'workspace.create' || action === 'break_glass.manage' || action === 'impersonation.start') {
      scopes.add('platform:*');
    } else {
      scopes.add(`workspace:${workspaceId}`);
    }
  });
  return Array.from(scopes);
};

export const searchWorkspaceAuditEvents = async ({
  workspaceId,
  auditEventRepository,
  preset,
  ...rest
}: {
  workspaceId: string;
  auditEventRepository: IAuditEventRepository;
  preset?: string | null;
} & Omit<AuditEventSearchInput, 'workspaceId'>) => {
  const presetFilters: Partial<AuditEventSearchInput> =
    preset === 'impersonation'
      ? { action: 'impersonation.start' }
      : preset === 'break_glass'
        ? { action: 'break_glass.manage' }
        : preset === 'role_binding'
          ? { action: 'role.manage' }
          : preset === 'identity_provider'
            ? { resourceType: 'identity_provider' }
            : preset === 'service_account'
              ? { resourceType: 'service_account' }
              : preset === 'api_token'
                ? { resourceType: 'api_token' }
                : {};

  return auditEventRepository.search({
    workspaceId,
    ...presetFilters,
    ...rest,
  });
};
