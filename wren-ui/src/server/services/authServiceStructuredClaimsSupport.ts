import {
  AuthorizationRoleSource,
  ensureAuthorizationCatalogSeeded,
  isAuthorizationBindingOnlyEnabled,
  syncPlatformAdminRoleBinding,
  syncWorkspaceMemberRoleBinding,
  toLegacyWorkspaceRoleKey,
  toLegacyWorkspaceRoleKeys,
} from '@server/authz';
import { getLogger } from '@server/utils';
import { User, Workspace, WorkspaceMember } from '../repositories';
import { ActorClaims, AuthServiceDependencies } from './authServiceTypes';

const logger = getLogger('AuthService');
logger.level = 'debug';

const ROLE_PERMISSION_SCOPES: Record<string, string[]> = {
  owner: ['workspace:*', 'knowledge_base:*'],
  admin: ['workspace:*', 'knowledge_base:*'],
  member: ['workspace:read', 'knowledge_base:read'],
};

export const toActorClaims = async ({
  user,
  workspace,
  membership,
  deps,
}: {
  user: User;
  workspace: Workspace;
  membership: WorkspaceMember;
  deps: AuthServiceDependencies;
}): Promise<ActorClaims> => {
  const structuredClaims = await resolveStructuredActorClaims({
    user,
    workspace,
    membership,
    deps,
  });

  const roleKeys =
    structuredClaims.workspaceRoleKeys.length > 0
      ? structuredClaims.workspaceRoleKeys
      : isAuthorizationBindingOnlyEnabled()
        ? []
        : [toLegacyWorkspaceRoleKey(membership.roleKey) || 'member'];

  return {
    userId: membership.userId,
    workspaceId: workspace.id,
    workspaceMemberId: membership.id,
    roleKeys,
    permissionScopes: roleKeys.length > 0 ? toPermissionScopes(roleKeys) : [],
    grantedActions: structuredClaims.grantedActions || [],
    workspaceRoleSource: structuredClaims.workspaceRoleSource,
    platformRoleSource: structuredClaims.platformRoleSource,
    platformRoleKeys: structuredClaims.platformRoleKeys,
    isPlatformAdmin: structuredClaims.isPlatformAdmin,
  };
};

export const resolveStructuredActorClaims = async ({
  user,
  workspace,
  membership,
  deps,
}: {
  user: User;
  workspace: Workspace;
  membership: WorkspaceMember;
  deps: AuthServiceDependencies;
}) => {
  if (!deps.principalRoleBindingRepository) {
    const platformAdminFallback = !isAuthorizationBindingOnlyEnabled()
      ? Boolean(user.isPlatformAdmin)
      : false;
    return {
      workspaceRoleKeys: isAuthorizationBindingOnlyEnabled()
        ? ([] as string[])
        : [toLegacyWorkspaceRoleKey(membership.roleKey) || 'member'],
      grantedActions: [] as string[],
      workspaceRoleSource: 'legacy' as AuthorizationRoleSource,
      platformRoleSource: 'legacy' as AuthorizationRoleSource,
      platformRoleKeys: platformAdminFallback ? ['platform_admin'] : [],
      isPlatformAdmin: platformAdminFallback,
    };
  }

  if (
    deps.roleRepository &&
    deps.permissionRepository &&
    deps.rolePermissionRepository
  ) {
    await ensureAuthorizationCatalogSeeded({
      roleRepository: deps.roleRepository,
      permissionRepository: deps.permissionRepository,
      rolePermissionRepository: deps.rolePermissionRepository,
    });
  }

  let structuredClaims = await loadStructuredActorClaims({
    user,
    workspace,
    deps,
  });

  const needsWorkspaceBackfill =
    !isSyntheticWorkspaceMembership(membership) &&
    membership.status === 'active' &&
    structuredClaims.workspaceBindings.length === 0;
  const needsPlatformBackfill =
    Boolean(user.isPlatformAdmin) &&
    structuredClaims.platformBindings.length === 0;

  if (
    (needsWorkspaceBackfill || needsPlatformBackfill) &&
    canSyncStructuredBindings(deps)
  ) {
    const tx = await deps.userRepository.transaction();
    try {
      if (needsPlatformBackfill) {
        await syncPlatformAdminRoleBinding({
          user,
          roleRepository: deps.roleRepository!,
          principalRoleBindingRepository: deps.principalRoleBindingRepository!,
          tx,
          createdBy: user.id,
        });
      }

      if (needsWorkspaceBackfill) {
        await syncWorkspaceMemberRoleBinding({
          membership,
          roleRepository: deps.roleRepository!,
          principalRoleBindingRepository: deps.principalRoleBindingRepository!,
          tx,
          createdBy: user.id,
        });
      }

      await deps.userRepository.commit(tx);
      structuredClaims = await loadStructuredActorClaims({
        user,
        workspace,
        deps,
      });
    } catch (error) {
      await deps.userRepository.rollback(tx);
      logger.warn(
        `Failed to backfill structured authorization bindings for user ${user.id} in workspace ${workspace.id}: ${String(
          error,
        )}`,
      );
    }
  }

  const {
    workspaceBindings,
    workspacePermissions,
    platformBindings,
    platformPermissions,
    groupBindings,
    groupPermissions,
  } = structuredClaims;

  const workspaceRoleKeys = toLegacyWorkspaceRoleKeys(
    [...workspaceBindings, ...groupBindings].map((binding) => binding.roleName),
  );
  const platformRoleKeys = Array.from(
    new Set(
      platformBindings
        .map((binding) => binding.roleName)
        .filter(Boolean)
        .map((roleKey) => String(roleKey).trim().toLowerCase()),
    ),
  );
  const grantedActions = Array.from(
    new Set([
      ...workspacePermissions,
      ...groupPermissions,
      ...platformPermissions,
    ]),
  );
  const hasStructuredWorkspaceBindings =
    workspaceBindings.length > 0 || groupBindings.length > 0;
  const hasStructuredPlatformBindings = platformBindings.length > 0;

  if (!hasStructuredWorkspaceBindings) {
    logger.warn(
      `AuthService missing structured workspace role binding for user ${user.id} in workspace ${workspace.id}`,
    );
  }

  if (Boolean(user.isPlatformAdmin) && !hasStructuredPlatformBindings) {
    logger.warn(
      `AuthService missing structured platform role binding for user ${user.id}`,
    );
  }

  return {
    workspaceRoleKeys:
      workspaceRoleKeys.length > 0
        ? workspaceRoleKeys
        : isAuthorizationBindingOnlyEnabled()
          ? []
          : [toLegacyWorkspaceRoleKey(membership.roleKey) || 'member'],
    grantedActions,
    workspaceRoleSource: hasStructuredWorkspaceBindings
      ? ('role_binding' as AuthorizationRoleSource)
      : ('legacy' as AuthorizationRoleSource),
    platformRoleSource: hasStructuredPlatformBindings
      ? ('role_binding' as AuthorizationRoleSource)
      : ('legacy' as AuthorizationRoleSource),
    platformRoleKeys:
      platformRoleKeys.length > 0
        ? platformRoleKeys
        : !isAuthorizationBindingOnlyEnabled() && user.isPlatformAdmin
          ? ['platform_admin']
          : [],
    isPlatformAdmin:
      platformRoleKeys.includes('platform_admin') ||
      (!isAuthorizationBindingOnlyEnabled() && Boolean(user.isPlatformAdmin)),
  };
};

export const canSyncStructuredBindings = (deps: AuthServiceDependencies) =>
  Boolean(
    deps.roleRepository &&
    deps.principalRoleBindingRepository &&
    typeof (deps.roleRepository as any).findByNames === 'function' &&
    typeof (deps.principalRoleBindingRepository as any)
      .findResolvedRoleBindings === 'function',
  );

export const isSyntheticWorkspaceMembership = (membership: WorkspaceMember) =>
  String(membership.id || '').startsWith('break_glass:');

export const loadStructuredActorClaims = async ({
  user,
  workspace,
  deps,
}: {
  user: User;
  workspace: Workspace;
  deps: AuthServiceDependencies;
}) => {
  const principalRoleBindingRepository = deps.principalRoleBindingRepository!;
  const [
    workspaceBindings,
    workspacePermissions,
    platformBindings,
    platformPermissions,
  ] = await Promise.all([
    principalRoleBindingRepository.findResolvedRoleBindings({
      principalType: 'user',
      principalId: user.id,
      scopeType: 'workspace',
      scopeId: workspace.id,
    }),
    principalRoleBindingRepository.findPermissionNamesByScope({
      principalType: 'user',
      principalId: user.id,
      scopeType: 'workspace',
      scopeId: workspace.id,
    }),
    principalRoleBindingRepository.findResolvedRoleBindings({
      principalType: 'user',
      principalId: user.id,
      scopeType: 'platform',
      scopeId: '',
    }),
    principalRoleBindingRepository.findPermissionNamesByScope({
      principalType: 'user',
      principalId: user.id,
      scopeType: 'platform',
      scopeId: '',
    }),
  ]);

  let groupBindings: Array<{ roleName: string }> = [];
  let groupPermissions: string[] = [];
  if (deps.directoryGroupMemberRepository && deps.directoryGroupRepository) {
    const groupMembers =
      await deps.directoryGroupMemberRepository.findAllByUser(
        workspace.id,
        user.id,
      );
    const groupIds = Array.from(
      new Set(
        groupMembers.map((member) => member.directoryGroupId).filter(Boolean),
      ),
    );
    if (groupIds.length > 0) {
      const groups = await Promise.all(
        groupIds.map((groupId) =>
          deps.directoryGroupRepository!.findOneBy({ id: groupId }),
        ),
      );
      const activeGroups = groups.filter(
        (group): group is NonNullable<typeof group> =>
          Boolean(
            group &&
            group.workspaceId === workspace.id &&
            group.status === 'active',
          ),
      );
      const groupResults = await Promise.all(
        activeGroups.map(async (group) => {
          const [bindings, permissions] = await Promise.all([
            principalRoleBindingRepository.findResolvedRoleBindings({
              principalType: 'group',
              principalId: group.id,
              scopeType: 'workspace',
              scopeId: workspace.id,
            }),
            principalRoleBindingRepository.findPermissionNamesByScope({
              principalType: 'group',
              principalId: group.id,
              scopeType: 'workspace',
              scopeId: workspace.id,
            }),
          ]);
          return { bindings, permissions };
        }),
      );
      groupBindings = groupResults.flatMap((item) => item.bindings as any);
      groupPermissions = groupResults.flatMap((item) => item.permissions);
    }
  }

  return {
    workspaceBindings,
    workspacePermissions,
    platformBindings,
    platformPermissions,
    groupBindings,
    groupPermissions,
  };
};

export const toPermissionScopes = (roleKeys: string[]) => {
  const normalizedRoleKeys = roleKeys.length > 0 ? roleKeys : ['member'];
  return Array.from(
    new Set(
      normalizedRoleKeys.flatMap(
        (roleKey) =>
          ROLE_PERMISSION_SCOPES[
            toLegacyWorkspaceRoleKey(roleKey) || 'member'
          ] || ROLE_PERMISSION_SCOPES.member,
      ),
    ),
  );
};

export const syncStructuredBindings = async ({
  user,
  membership,
  tx,
  deps,
}: {
  user: User;
  membership: WorkspaceMember;
  tx: any;
  deps: AuthServiceDependencies;
}) => {
  if (!deps.roleRepository || !deps.principalRoleBindingRepository) {
    return;
  }

  await syncPlatformAdminRoleBinding({
    user,
    roleRepository: deps.roleRepository,
    principalRoleBindingRepository: deps.principalRoleBindingRepository,
    tx,
    createdBy: user.id,
  });

  await syncWorkspaceMemberRoleBinding({
    membership,
    roleRepository: deps.roleRepository,
    principalRoleBindingRepository: deps.principalRoleBindingRepository,
    tx,
    createdBy: user.id,
  });
};
