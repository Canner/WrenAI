import {
  PLATFORM_SCOPE_ID,
  isAuthorizationBindingOnlyEnabled,
  isPlatformAdminRoleName,
} from '@server/authz';
import { WORKSPACE_KINDS } from '@/utils/workspaceGovernance';
import { User, WorkspaceMember } from '../repositories';
import { AuthResult, AuthServiceDependencies } from './authServiceTypes';
import { toActorClaims } from './authServiceStructuredClaimsSupport';

export const resolveActorClaims = async ({
  userOrId,
  workspaceId,
  deps,
}: {
  userOrId: User | string;
  workspaceId?: string;
  deps: AuthServiceDependencies;
}): Promise<Pick<AuthResult, 'workspace' | 'membership' | 'actorClaims'>> => {
  const user =
    typeof userOrId === 'string'
      ? await deps.userRepository.findOneBy({ id: userOrId })
      : userOrId;
  if (!user) {
    throw new Error('User not found');
  }

  let membership: WorkspaceMember | null = null;

  if (workspaceId) {
    membership = await deps.workspaceMemberRepository.findOneBy({
      userId: user.id,
      workspaceId,
      status: 'active',
    });
    if (!membership && (await hasPlatformAdminCapability(user, deps))) {
      const adminWorkspace = await deps.workspaceRepository.findOneBy({
        id: workspaceId,
      });
      if (adminWorkspace?.status === 'active') {
        membership = buildSyntheticPlatformAdminMembership({
          userId: user.id,
          workspaceId: adminWorkspace.id,
        });
      }
    }
  } else {
    const memberships = await deps.workspaceMemberRepository.findAllBy({
      userId: user.id,
      status: 'active',
    });
    if (user.defaultWorkspaceId) {
      membership =
        memberships.find(
          (candidate) => candidate.workspaceId === user.defaultWorkspaceId,
        ) || null;
    }

    if (!membership && memberships.length > 0) {
      const workspaces = await Promise.all(
        memberships.map((candidate) =>
          deps.workspaceRepository.findOneBy({ id: candidate.workspaceId }),
        ),
      );

      membership =
        memberships.find(
          (_candidate, index) =>
            workspaces[index]?.kind === WORKSPACE_KINDS.DEFAULT,
        ) ||
        memberships[0] ||
        null;
    }

    if (!membership && (await hasPlatformAdminCapability(user, deps))) {
      const adminWorkspace = await resolvePlatformAdminWorkspace(user, deps);
      if (adminWorkspace) {
        membership = buildSyntheticPlatformAdminMembership({
          userId: user.id,
          workspaceId: adminWorkspace.id,
        });
      }
    }
  }

  if (!membership && workspaceId && deps.breakGlassGrantRepository) {
    const grant = await deps.breakGlassGrantRepository.findActiveGrantForUser(
      workspaceId,
      user.id,
    );
    if (grant) {
      membership = {
        id: `break_glass:${grant.id}`,
        workspaceId,
        userId: user.id,
        roleKey: grant.roleKey,
        status: 'active',
        createdAt: grant.createdAt || null,
        updatedAt: grant.updatedAt || null,
      } as WorkspaceMember;
    }
  }

  if (!membership) {
    throw new Error('Active workspace membership is required');
  }

  const workspace = await deps.workspaceRepository.findOneBy({
    id: membership.workspaceId,
  });
  if (!workspace || workspace.status !== 'active') {
    throw new Error('Workspace is not active');
  }

  return {
    workspace,
    membership,
    actorClaims: await toActorClaims({
      user,
      workspace,
      membership,
      deps,
    }),
  };
};

export const hasPlatformAdminCapability = async (
  user: User,
  deps: AuthServiceDependencies,
) => {
  if (deps.principalRoleBindingRepository) {
    const bindings =
      (await deps.principalRoleBindingRepository.findResolvedRoleBindings({
        principalType: 'user',
        principalId: user.id,
        scopeType: 'platform',
        scopeId: PLATFORM_SCOPE_ID,
      })) || [];

    if (bindings.some((binding) => isPlatformAdminRoleName(binding.roleName))) {
      return true;
    }

    if (isAuthorizationBindingOnlyEnabled()) {
      return false;
    }
  }

  return Boolean(user.isPlatformAdmin);
};

export const buildSyntheticPlatformAdminMembership = ({
  userId,
  workspaceId,
}: {
  userId: string;
  workspaceId: string;
}): WorkspaceMember => ({
  id: `platform_admin:${workspaceId}:${userId}`,
  workspaceId,
  userId,
  roleKey: 'admin',
  status: 'active',
  createdAt: null,
  updatedAt: null,
});

export const resolvePlatformAdminWorkspace = async (
  user: User,
  deps: AuthServiceDependencies,
) => {
  if (user.defaultWorkspaceId) {
    const defaultWorkspace = await deps.workspaceRepository.findOneBy({
      id: user.defaultWorkspaceId,
    });
    if (defaultWorkspace?.status === 'active') {
      return defaultWorkspace;
    }
  }

  const defaultWorkspace =
    (await deps.workspaceBootstrapService?.findDefaultWorkspace?.()) ||
    (await deps.workspaceRepository.findOneBy({
      kind: WORKSPACE_KINDS.DEFAULT,
    }));
  if (defaultWorkspace?.status === 'active') {
    return defaultWorkspace;
  }

  const activeWorkspaces =
    (await deps.workspaceRepository.findAllBy({
      status: 'active',
    })) || [];

  return activeWorkspaces[0] || null;
};
