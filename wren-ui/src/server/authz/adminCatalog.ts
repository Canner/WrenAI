import { AuthorizationResource, authorize } from './authorize';
import { PLATFORM_SCOPE_ID, toLegacyWorkspaceRoleKeys } from './roleMapping';
import { isAuthorizationAction } from './permissionRegistry';
import {
  IAuditEventRepository,
  AuditEventSearchInput,
  Role,
} from '@server/repositories';
import {
  buildActionCatalog,
  buildPermissionMap,
  buildPrincipalLabel,
  getWorkspaceRoleKey,
  isRoleVisibleInWorkspace,
  normalizeRoleDisplayName,
  rolePermissionsToScopes,
} from './adminCatalogHelpers';
import type {
  BindingCatalogDeps,
  RoleCatalogDeps,
  WorkspaceRoleBindingItem,
  WorkspaceRoleCatalogItem,
} from './adminCatalogTypes';

export type {
  BindingCatalogDeps,
  RoleCatalogDeps,
  WorkspaceRoleBindingItem,
  WorkspaceRoleCatalogItem,
} from './adminCatalogTypes';
export {
  createCustomWorkspaceRole,
  createWorkspaceRoleBinding,
  deleteCustomWorkspaceRole,
  deleteWorkspaceRoleBinding,
  updateCustomWorkspaceRole,
} from './adminCatalogMutations';

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
      name: getWorkspaceRoleKey(role, workspaceId),
      displayName: normalizeRoleDisplayName(role),
      description: role.description || null,
      scopeType: role.scopeType,
      scopeId: role.scopeId || '',
      isSystem: Boolean(role.isSystem),
      isActive: role.isActive !== false,
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
    actionCatalog: buildActionCatalog(permissionData.permissions),
  };
};

export const listWorkspaceRoleBindings = async ({
  workspaceId,
  roleRepository,
  principalRoleBindingRepository,
  userRepository,
  workspaceMemberRepository,
  directoryGroupRepository,
  serviceAccountRepository,
}: Omit<
  BindingCatalogDeps,
  | 'permissionRepository'
  | 'rolePermissionRepository'
  | 'directoryGroupMemberRepository'
> & {
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
          roleName: getWorkspaceRoleKey(role, workspaceId),
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
      String(left!.roleDisplayName).localeCompare(
        String(right!.roleDisplayName),
      ),
    ) as WorkspaceRoleBindingItem[];
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

  let groupBindings: Array<{
    roleName: string;
    groupId: string;
    groupName: string;
  }> = [];
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
        Boolean(
          group &&
            group.workspaceId === workspaceId &&
            group.status === 'active',
        ),
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
    new Set([
      ...directPermissions,
      ...groupPermissions,
      ...platformPermissions,
    ]),
  );
  const workspaceRoleKeys = toLegacyWorkspaceRoleKeys([
    ...directBindings.map((binding) => binding.roleName),
    ...groupBindings.map((binding) => binding.roleName),
  ]);
  const platformRoleKeys = Array.from(
    new Set(
      platformBindings.map((binding) =>
        String(binding.roleName || '')
          .trim()
          .toLowerCase(),
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
    platformRoleSource:
      platformBindings.length > 0 ? ('role_binding' as const) : undefined,
    sessionId: null,
  };

  const decision =
    action && isAuthorizationAction(action)
      ? authorize({
          actor,
          action,
          resource: resource || {
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
        roleByName.get(binding.roleName) ||
          ({ name: binding.roleName } as Role),
      ),
    })),
    groupBindings: groupBindings.map((binding) => ({
      groupId: binding.groupId,
      groupName: binding.groupName,
      roleName: binding.roleName,
      roleDisplayName: normalizeRoleDisplayName(
        roleByName.get(binding.roleName) ||
          ({ name: binding.roleName } as Role),
      ),
    })),
    platformBindings: platformBindings.map((binding) => ({
      roleName: binding.roleName,
      roleDisplayName: normalizeRoleDisplayName(
        roleByName.get(binding.roleName) ||
          ({ name: binding.roleName } as Role),
      ),
    })),
    grantedActions,
    decision,
  };
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
