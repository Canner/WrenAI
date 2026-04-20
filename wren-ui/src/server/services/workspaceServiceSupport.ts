import {
  IPrincipalRoleBindingRepository,
  IRoleRepository,
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
  IUserRepository,
  WorkspaceMember,
} from '../repositories';
import {
  AuthorizationAction,
  AuthorizationActor,
  PLATFORM_SCOPE_ID,
  authorize,
  isAuthorizationBindingOnlyEnabled,
  isPlatformAdminRoleName,
  toLegacyWorkspaceRoleKey,
  removeWorkspacePrincipalRoleBindings,
  syncWorkspaceMemberRoleBinding,
} from '@server/authz';
import {
  canManageWorkspaceJoinFlow,
  WORKSPACE_KINDS,
} from '@/utils/workspaceGovernance';
import type { ValidateSessionResult } from './authService';

export const assertWorkspaceActorAllowed = ({
  actor,
  action,
  workspaceId,
  resourceType,
  resourceId,
  ownerUserId,
  attributes,
}: {
  actor?: AuthorizationActor | null;
  action: AuthorizationAction;
  workspaceId: string;
  resourceType: string;
  resourceId?: string | null;
  ownerUserId?: string | null;
  attributes?: Record<string, any>;
}) => {
  if (!actor) {
    throw new Error('Service authorization actor is required');
  }
  const decision = authorize({
    actor,
    action,
    resource: {
      resourceType,
      resourceId: resourceId || workspaceId,
      workspaceId,
      ownerUserId: ownerUserId || null,
      attributes,
    },
  });
  if (!decision.allowed) {
    const error = new Error(
      decision.reason || `Actor is not allowed to perform ${action}`,
    ) as Error & { statusCode?: number };
    error.statusCode = decision.statusCode;
    throw error;
  }
};

export const hasPlatformAdminWorkspaceAccess = async ({
  userId,
  principalRoleBindingRepository,
  userRepository,
}: {
  userId: string;
  principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
  userRepository: IUserRepository;
}) => {
  if (principalRoleBindingRepository) {
    const bindings =
      (await principalRoleBindingRepository.findResolvedRoleBindings({
        principalType: 'user',
        principalId: userId,
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

  const user = await userRepository.findOneBy({ id: userId });
  return Boolean(user?.isPlatformAdmin);
};

export const buildDefaultWorkspaceAuthorizationActor = (
  validatedSession: ValidateSessionResult,
): AuthorizationActor => ({
  principalType: 'user',
  principalId: validatedSession.user.id,
  workspaceId: validatedSession.workspace.id,
  workspaceMemberId: validatedSession.membership.id,
  workspaceRoleKeys: validatedSession.actorClaims.roleKeys || [],
  permissionScopes: validatedSession.actorClaims.permissionScopes || [],
  isPlatformAdmin: Boolean(validatedSession.actorClaims.isPlatformAdmin),
  platformRoleKeys: validatedSession.actorClaims.platformRoleKeys || [],
  grantedActions: validatedSession.actorClaims.grantedActions || [],
  workspaceRoleSource: validatedSession.actorClaims.workspaceRoleSource,
  platformRoleSource: validatedSession.actorClaims.platformRoleSource,
  sessionId: validatedSession.session.id,
});

export const ensureUniqueWorkspaceSlug = async ({
  candidate,
  workspaceRepository,
}: {
  candidate: string;
  workspaceRepository: IWorkspaceRepository;
}) => {
  const baseSlug =
    candidate
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace';

  let slug = baseSlug;
  let suffix = 2;
  while (await workspaceRepository.findOneBy({ slug })) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
};

export const requireRegularWorkspaceForJoinFlow = async ({
  workspaceId,
  workspaceRepository,
}: {
  workspaceId: string;
  workspaceRepository: IWorkspaceRepository;
}) => {
  const workspace = await workspaceRepository.findOneBy({
    id: workspaceId,
  });
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  if (!canManageWorkspaceJoinFlow(workspace.kind)) {
    throw new Error('Default workspace does not support this operation');
  }

  return workspace;
};

export const assertOwnerWorkspaceMembershipMutationAllowed = async (
  membership: WorkspaceMember,
  patch: Partial<WorkspaceMember>,
  workspaceMemberRepository: IWorkspaceMemberRepository,
) => {
  const currentRoleKey = toLegacyWorkspaceRoleKey(membership.roleKey);
  if (!['owner', 'admin'].includes(currentRoleKey || '')) {
    return;
  }

  const nextRoleKey =
    toLegacyWorkspaceRoleKey(patch.roleKey ?? membership.roleKey) ||
    patch.roleKey ||
    membership.roleKey;
  const nextStatus = patch.status ?? membership.status;

  if (
    ['owner', 'admin'].includes(String(nextRoleKey).toLowerCase()) &&
    nextStatus === 'active'
  ) {
    return;
  }

  const activeMembers = await workspaceMemberRepository.findAllBy({
    workspaceId: membership.workspaceId,
    status: 'active',
  });
  const remainingOwnerCount = activeMembers.filter((candidate) => {
    if (candidate.id === membership.id) {
      return false;
    }

    return ['owner', 'admin'].includes(
      toLegacyWorkspaceRoleKey(candidate.roleKey) || '',
    );
  }).length;

  if (remainingOwnerCount === 0) {
    throw new Error('Workspace must keep at least one active owner');
  }
};

export const syncWorkspaceMemberBindingForService = async ({
  membership,
  tx,
  roleRepository,
  principalRoleBindingRepository,
}: {
  membership: WorkspaceMember;
  tx: any;
  roleRepository?: IRoleRepository;
  principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
}) => {
  if (!roleRepository || !principalRoleBindingRepository) {
    return;
  }

  await syncWorkspaceMemberRoleBinding({
    membership,
    roleRepository,
    principalRoleBindingRepository,
    tx,
    createdBy: membership.userId,
  });
};

export const removeWorkspaceMemberBindingForService = async ({
  membership,
  tx,
  principalRoleBindingRepository,
}: {
  membership: WorkspaceMember;
  tx: any;
  principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
}) => {
  if (!principalRoleBindingRepository) {
    return;
  }

  await removeWorkspacePrincipalRoleBindings({
    workspaceId: membership.workspaceId,
    principalId: membership.userId,
    principalRoleBindingRepository,
    tx,
  });
};

export const updateWorkspaceMemberByRecord = async ({
  membership,
  patch,
  workspaceRepository,
  workspaceMemberRepository,
  roleRepository,
  principalRoleBindingRepository,
}: {
  membership: WorkspaceMember;
  patch: Partial<WorkspaceMember>;
  workspaceRepository: IWorkspaceRepository;
  workspaceMemberRepository: IWorkspaceMemberRepository;
  roleRepository?: IRoleRepository;
  principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
}) => {
  await assertOwnerWorkspaceMembershipMutationAllowed(
    membership,
    patch,
    workspaceMemberRepository,
  );
  const tx = await workspaceRepository.transaction();
  try {
    const updatedMembership = await workspaceMemberRepository.updateOne(
      membership.id,
      patch,
      { tx },
    );
    await syncWorkspaceMemberBindingForService({
      membership: updatedMembership,
      tx,
      roleRepository,
      principalRoleBindingRepository,
    });
    await workspaceRepository.commit(tx);
    return updatedMembership;
  } catch (error) {
    await workspaceRepository.rollback(tx);
    throw error;
  }
};

export { WORKSPACE_KINDS };

export const applyUserToWorkspace = async ({
  workspaceId,
  userId,
  workspaceRepository,
  workspaceMemberRepository,
  addMember,
}: {
  workspaceId: string;
  userId: string;
  workspaceRepository: IWorkspaceRepository;
  workspaceMemberRepository: IWorkspaceMemberRepository;
  addMember: (input: {
    workspaceId: string;
    userId: string;
    roleKey?: string;
    status?: string;
  }) => Promise<WorkspaceMember>;
}) => {
  await requireRegularWorkspaceForJoinFlow({
    workspaceId,
    workspaceRepository,
  });
  const existingMembership = await workspaceMemberRepository.findOneBy({
    workspaceId,
    userId,
  });

  if (existingMembership?.status === 'active') {
    return existingMembership;
  }

  if (existingMembership?.status === 'invited') {
    return existingMembership;
  }

  return await addMember({
    workspaceId,
    userId,
    roleKey: existingMembership?.roleKey || 'member',
    status: 'pending',
  });
};

export const acceptWorkspaceInvitation = async ({
  workspaceId,
  userId,
  workspaceRepository,
  workspaceMemberRepository,
  workspaceServiceDeps,
}: {
  workspaceId: string;
  userId: string;
  workspaceRepository: IWorkspaceRepository;
  workspaceMemberRepository: IWorkspaceMemberRepository;
  workspaceServiceDeps: {
    roleRepository?: IRoleRepository;
    principalRoleBindingRepository?: IPrincipalRoleBindingRepository;
  };
}) => {
  await requireRegularWorkspaceForJoinFlow({
    workspaceId,
    workspaceRepository,
  });
  const membership = await workspaceMemberRepository.findOneBy({
    workspaceId,
    userId,
  });

  if (!membership || membership.status !== 'invited') {
    throw new Error('Invited workspace membership is required');
  }

  return await updateWorkspaceMemberByRecord({
    membership,
    patch: {
      status: 'active',
    },
    workspaceRepository,
    workspaceMemberRepository,
    roleRepository: workspaceServiceDeps.roleRepository,
    principalRoleBindingRepository:
      workspaceServiceDeps.principalRoleBindingRepository,
  });
};
