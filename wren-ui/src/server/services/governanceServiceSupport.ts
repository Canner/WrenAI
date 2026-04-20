import crypto from 'crypto';
import { PLATFORM_SCOPE_ID } from '@server/authz';
import { canManageWorkspaceJoinFlow } from '@/utils/workspaceGovernance';
import type { AuthResult, ValidateSessionResult } from './authService';
import { AccessReviewItem } from '@server/repositories';
import {
  AccessReviewWithItems,
  BreakGlassGrantWithUser,
  GovernanceServiceDependencies,
} from './governanceServiceTypes';

const toGrantUser = (user: any) =>
  user
    ? {
        id: user.id,
        email: user.email,
        displayName: user.displayName ?? null,
        status: user.status,
      }
    : null;

export const listAccessReviews = async (
  workspaceId: string,
  deps: GovernanceServiceDependencies,
): Promise<AccessReviewWithItems[]> => {
  await requireWorkspace(workspaceId, deps);
  const [reviews, items] = await Promise.all([
    deps.accessReviewRepository.findAllBy(
      { workspaceId },
      { order: 'created_at desc' },
    ),
    deps.accessReviewItemRepository.findAllBy(
      { workspaceId },
      { order: 'created_at asc' },
    ),
  ]);

  const itemsByReviewId = items.reduce<Record<string, AccessReviewItem[]>>(
    (acc, item) => {
      acc[item.accessReviewId] = acc[item.accessReviewId] || [];
      acc[item.accessReviewId].push(item);
      return acc;
    },
    {},
  );

  return reviews.map((review) => ({
    ...review,
    items: itemsByReviewId[review.id] || [],
  }));
};

export const createAccessReview = async (
  input: {
    validatedSession: ValidateSessionResult;
    title: string;
    dueAt?: Date | string | null;
    notes?: string | null;
  },
  deps: GovernanceServiceDependencies,
): Promise<AccessReviewWithItems> => {
  const workspaceId = input.validatedSession.workspace.id;
  const actorUserId = input.validatedSession.user.id;
  await requireGovernanceWorkspace(workspaceId, deps);
  const members = await deps.workspaceMemberRepository.findAllBy({
    workspaceId,
    status: 'active',
  });
  const review = await deps.accessReviewRepository.createOne({
    id: crypto.randomUUID(),
    workspaceId,
    title: input.title.trim(),
    status: 'open',
    createdBy: actorUserId,
    startedAt: new Date(),
    dueAt: input.dueAt || null,
    notes: input.notes || null,
  });

  const items = await deps.accessReviewItemRepository.createMany(
    members.map((member) => ({
      id: crypto.randomUUID(),
      accessReviewId: review.id,
      workspaceId,
      workspaceMemberId: member.id,
      userId: member.userId,
      roleKey: member.roleKey,
      status: 'pending',
    })),
  );

  return { ...review, items };
};

export const reviewAccessReviewItem = async (
  input: {
    validatedSession: ValidateSessionResult;
    accessReviewId: string;
    itemId: string;
    decision: 'keep' | 'remove';
    notes?: string | null;
  },
  deps: GovernanceServiceDependencies,
): Promise<AccessReviewWithItems> => {
  const workspaceId = input.validatedSession.workspace.id;
  const actorUserId = input.validatedSession.user.id;
  await requireGovernanceWorkspace(workspaceId, deps);

  const review = await deps.accessReviewRepository.findOneBy({
    id: input.accessReviewId,
  });
  if (!review || review.workspaceId !== workspaceId) {
    throw new Error('Access review not found');
  }

  const item = await deps.accessReviewItemRepository.findOneBy({
    id: input.itemId,
  });
  if (
    !item ||
    item.accessReviewId !== review.id ||
    item.workspaceId !== workspaceId
  ) {
    throw new Error('Access review item not found');
  }

  const updatedItem = await deps.accessReviewItemRepository.updateOne(item.id, {
    decision: input.decision,
    status: 'reviewed',
    reviewedBy: actorUserId,
    reviewedAt: new Date(),
    notes: input.notes || null,
  });

  if (input.decision === 'remove' && item.workspaceMemberId) {
    const membership = await deps.workspaceMemberRepository.findOneBy({
      id: item.workspaceMemberId,
    });
    if (membership && membership.workspaceId === workspaceId) {
      await deps.workspaceService.updateMember({
        workspaceId,
        memberId: membership.id,
        status: 'inactive',
      });
    }
  }

  const reviewItems = await deps.accessReviewItemRepository.findAllBy({
    accessReviewId: review.id,
  });
  const allReviewed = reviewItems.every((reviewItem) =>
    reviewItem.id === updatedItem.id ? true : reviewItem.status === 'reviewed',
  );
  const normalizedItems = reviewItems.map((reviewItem) =>
    reviewItem.id === updatedItem.id ? updatedItem : reviewItem,
  );

  const nextReview = allReviewed
    ? await deps.accessReviewRepository.updateOne(review.id, {
        status: 'completed',
        completedBy: actorUserId,
        completedAt: new Date(),
      })
    : review;

  return { ...nextReview, items: normalizedItems };
};

export const startImpersonation = async (
  input: {
    validatedSession: ValidateSessionResult;
    targetUserId: string;
    workspaceId?: string;
    reason: string;
  },
  deps: GovernanceServiceDependencies,
): Promise<AuthResult> => {
  const adminUserId = input.validatedSession.user.id;
  const [adminUser, targetUser] = await Promise.all([
    deps.userRepository.findOneBy({ id: adminUserId }),
    deps.userRepository.findOneBy({ id: input.targetUserId }),
  ]);
  if (!adminUser || !(await hasPlatformAdminAuthority(adminUser, deps))) {
    throw new Error('Platform admin permission required');
  }
  if (!targetUser || targetUser.status !== 'active') {
    throw new Error('Target user not found');
  }

  const identity = await findPreferredAuthIdentity(targetUser.id, deps);
  if (!identity) {
    throw new Error('Target user has no login identity');
  }

  return await deps.authService.issueSessionForIdentity({
    userId: targetUser.id,
    authIdentityId: identity.id,
    workspaceId: input.workspaceId,
    impersonatorUserId: adminUserId,
    impersonationReason: input.reason,
  });
};

export const stopImpersonation = async (
  validatedSession: ValidateSessionResult,
  deps: GovernanceServiceDependencies,
): Promise<AuthResult> => {
  const impersonatorUserId = validatedSession.session.impersonatorUserId;
  if (!impersonatorUserId) {
    throw new Error('Current session is not impersonated');
  }

  const identity = await findPreferredAuthIdentity(impersonatorUserId, deps);
  if (!identity) {
    throw new Error('Unable to restore impersonator session');
  }

  await deps.authSessionRepository.updateOne(validatedSession.session.id, {
    revokedAt: new Date(),
  });

  return await deps.authService.issueSessionForIdentity({
    userId: impersonatorUserId,
    authIdentityId: identity.id,
  });
};

export const listBreakGlassGrants = async (
  workspaceId: string,
  deps: GovernanceServiceDependencies,
): Promise<BreakGlassGrantWithUser[]> => {
  await requireWorkspace(workspaceId, deps);
  const grants = await requireBreakGlassGrantRepository(deps).findAllBy(
    { workspaceId },
    { order: 'created_at desc' },
  );
  const users = await Promise.all(
    grants.map((grant) => deps.userRepository.findOneBy({ id: grant.userId })),
  );

  return grants.map((grant, index) => ({
    ...grant,
    user: toGrantUser(users[index]),
  }));
};

export const createBreakGlassGrant = async (
  input: {
    validatedSession: ValidateSessionResult;
    userId: string;
    roleKey?: string;
    reason: string;
    expiresAt: Date | string;
  },
  deps: GovernanceServiceDependencies,
): Promise<BreakGlassGrantWithUser> => {
  const workspaceId = input.validatedSession.workspace.id;
  const actorUserId = input.validatedSession.user.id;
  await requireWorkspace(workspaceId, deps);
  const repository = requireBreakGlassGrantRepository(deps);
  const user = await deps.userRepository.findOneBy({ id: input.userId });
  if (!user) {
    throw new Error('Target user not found');
  }

  const tx = await repository.transaction();
  try {
    const existing = await repository.findActiveGrantForUser(
      workspaceId,
      input.userId,
      { tx },
    );
    if (existing) {
      await repository.updateOne(
        existing.id,
        {
          status: 'revoked',
          revokedAt: new Date(),
          revokedBy: actorUserId,
        },
        { tx },
      );
    }

    const grant = await repository.createOne(
      {
        id: crypto.randomUUID(),
        workspaceId,
        userId: input.userId,
        roleKey: input.roleKey || 'owner',
        status: 'active',
        reason: input.reason.trim(),
        expiresAt: input.expiresAt,
        createdBy: actorUserId,
      },
      { tx },
    );

    await repository.commit(tx);
    return {
      ...grant,
      user: toGrantUser(user),
    };
  } catch (error) {
    await repository.rollback(tx);
    throw error;
  }
};

export const revokeBreakGlassGrant = async (
  input: {
    validatedSession: ValidateSessionResult;
    id: string;
  },
  deps: GovernanceServiceDependencies,
): Promise<BreakGlassGrantWithUser> => {
  const workspaceId = input.validatedSession.workspace.id;
  const actorUserId = input.validatedSession.user.id;
  await requireWorkspace(workspaceId, deps);
  const repository = requireBreakGlassGrantRepository(deps);
  const grant = await repository.findOneBy({ id: input.id });
  if (!grant || grant.workspaceId !== workspaceId) {
    throw new Error('Break-glass grant not found');
  }

  const updated = await repository.updateOne(grant.id, {
    status: 'revoked',
    revokedAt: new Date(),
    revokedBy: actorUserId,
  });
  const user = await deps.userRepository.findOneBy({ id: updated.userId });
  return {
    ...updated,
    user: toGrantUser(user),
  };
};

export const findPreferredAuthIdentity = async (
  userId: string,
  deps: GovernanceServiceDependencies,
) => {
  const identities = await deps.authIdentityRepository.findAllBy({ userId });
  return (
    identities.find((identity) => identity.providerType === 'local') ||
    identities[0] ||
    null
  );
};

export const requireWorkspace = async (
  workspaceId: string,
  deps: GovernanceServiceDependencies,
) => {
  const workspace = await deps.workspaceService.getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }
  return workspace;
};

export const requireGovernanceWorkspace = async (
  workspaceId: string,
  deps: GovernanceServiceDependencies,
) => {
  const workspace = await requireWorkspace(workspaceId, deps);
  if (!canManageWorkspaceJoinFlow(workspace.kind)) {
    throw new Error(
      'Default workspace does not support this governance action',
    );
  }
  return workspace;
};

export const hasPlatformAdminAuthority = async (
  user: {
    id: string;
    isPlatformAdmin?: boolean | null;
  },
  deps: GovernanceServiceDependencies,
) => {
  if (!deps.principalRoleBindingRepository) {
    return false;
  }

  const bindings =
    await deps.principalRoleBindingRepository.findResolvedRoleBindings({
      principalType: 'user',
      principalId: user.id,
      scopeType: 'platform',
      scopeId: PLATFORM_SCOPE_ID,
    });

  return bindings.some(
    (binding) =>
      String(binding.roleName || '')
        .trim()
        .toLowerCase() === 'platform_admin',
  );
};

export const requireBreakGlassGrantRepository = (
  deps: GovernanceServiceDependencies,
) => {
  if (!deps.breakGlassGrantRepository) {
    throw new Error('Break-glass grant repository is not configured');
  }
  return deps.breakGlassGrantRepository;
};
