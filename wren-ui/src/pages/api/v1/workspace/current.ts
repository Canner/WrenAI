import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  WORKSPACE_KINDS,
  normalizeWorkspaceRoleKeyForDisplay,
} from '@/utils/workspaceGovernance';
import { PLATFORM_SCOPE_ID } from '@server/authz';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  serializeAuthorizationActor,
} from '@server/authz';
import { buildWorkspacePermissionActions } from './workspaceCurrentPermissions';
import {
  type BindingSourceDetail,
  sortApplications,
  sortByName,
  sortMembers,
  sortUsers,
  toApiTokenView,
  toBindingSummaryLabel,
  toBreakGlassGrantView,
  toDirectoryGroupView,
  toOwnerCandidateView,
  toServiceAccountView,
  toWorkspaceView,
} from './workspaceCurrentViews';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const workspaceId = getQueryString(req.query.workspaceId);
    const validatedSession = await components.authService.validateSession(
      sessionToken,
      workspaceId,
    );

    if (!validatedSession) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentWorkspaceId = validatedSession.workspace.id;
    const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor.sessionId,
    });
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.read',
      resource: {
        resourceType: 'workspace',
        resourceId: currentWorkspaceId,
        workspaceId: currentWorkspaceId,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      },
      context: auditContext,
    });
    const {
      canManageMembers,
      canInviteMembers,
      canApproveMembers,
      canManageSchedules,
      canCreateWorkspace,
      actions: permissionActions,
    } = buildWorkspacePermissionActions({
      actor,
      workspace: validatedSession.workspace,
      user: validatedSession.user,
    });
    const [
      workspaces,
      allWorkspaces,
      knowledgeBases,
      members,
      myMemberships,
      ownerCandidates,
      serviceAccounts,
      apiTokens,
      identityProviders,
      accessReviews,
      directoryGroups,
      breakGlassGrants,
    ] = await Promise.all([
      components.workspaceService.listWorkspacesForUser(
        validatedSession.user.id,
      ),
      components.workspaceRepository.findAllBy({ status: 'active' }),
      components.knowledgeBaseRepository.findAllBy({
        workspaceId: currentWorkspaceId,
      }),
      components.workspaceMemberRepository.findAllBy({
        workspaceId: currentWorkspaceId,
      }),
      components.workspaceMemberRepository.findAllBy({
        userId: validatedSession.user.id,
      }),
      canCreateWorkspace
        ? components.userRepository.findAllBy({ status: 'active' })
        : Promise.resolve([]),
      permissionActions['service_account.read']
        ? components.automationService.listServiceAccounts(
            validatedSession.workspace.id,
          )
        : Promise.resolve([]),
      permissionActions['api_token.read']
        ? components.automationService.listApiTokens({
            workspaceId: validatedSession.workspace.id,
          })
        : Promise.resolve([]),
      permissionActions['identity_provider.read']
        ? components.identityProviderService.listProviders(
            validatedSession.workspace.id,
          )
        : Promise.resolve([]),
      permissionActions['access_review.read']
        ? components.governanceService.listAccessReviews(
            validatedSession.workspace.id,
          )
        : Promise.resolve([]),
      permissionActions['group.read']
        ? components.governanceService.listDirectoryGroups(
            validatedSession.workspace.id,
          )
        : Promise.resolve([]),
      permissionActions['break_glass.manage']
        ? components.governanceService.listBreakGlassGrants(
            validatedSession.workspace.id,
          )
        : Promise.resolve([]),
    ]);

    const principalRoleBindingRepository =
      components.principalRoleBindingRepository;

    const memberUsers = await Promise.all(
      members.map((member) =>
        components.userRepository.findOneBy({ id: member.userId }),
      ),
    );

    const workspaceById = new Map(
      allWorkspaces.map((workspace) => [workspace.id, workspace]),
    );
    const occupiedWorkspaceIds = new Set(
      myMemberships.map((membership) => membership.workspaceId),
    );
    const discoverableWorkspaces = allWorkspaces.filter(
      (workspace) =>
        workspace.kind !== WORKSPACE_KINDS.DEFAULT &&
        !occupiedWorkspaceIds.has(workspace.id),
    );

    const serializedMembers = sortMembers(
      members.map((member, index) => {
        const memberUser = memberUsers[index];
        return {
          ...member,
          roleKey: normalizeWorkspaceRoleKeyForDisplay(member.roleKey) || 'viewer',
          user: memberUser
            ? {
                id: memberUser.id,
                email: memberUser.email,
                displayName: memberUser.displayName,
                status: memberUser.status,
              }
            : null,
        };
      }),
    );

    const [
      memberBindingEntries,
      serviceAccountBindingEntries,
      ownerCandidatePlatformBindingEntries,
    ] = principalRoleBindingRepository
      ? await Promise.all([
          Promise.all(
            serializedMembers.map(async (member) => [
              member.userId,
              await principalRoleBindingRepository.findResolvedRoleBindings({
                principalType: 'user',
                principalId: member.userId,
                scopeType: 'workspace',
                scopeId: currentWorkspaceId,
              }),
            ]),
          ),
          Promise.all(
            serviceAccounts.map(async (serviceAccount) => [
              serviceAccount.id,
              await principalRoleBindingRepository.findResolvedRoleBindings({
                principalType: 'service_account',
                principalId: serviceAccount.id,
                scopeType: 'workspace',
                scopeId: currentWorkspaceId,
              }),
            ]),
          ),
          Promise.all(
            ownerCandidates.map(async (candidate) => [
              candidate.id,
              await principalRoleBindingRepository.findResolvedRoleBindings({
                principalType: 'user',
                principalId: candidate.id,
                scopeType: 'platform',
                scopeId: PLATFORM_SCOPE_ID,
              }),
            ]),
          ),
        ])
      : [[], [], []];

    const memberBindingsByUserId = new Map(
      memberBindingEntries as Array<
        [string, Array<{ roleName?: string | null }>]
      >,
    );
    const serviceAccountBindingsById = new Map(
      serviceAccountBindingEntries as Array<
        [string, Array<{ roleName?: string | null }>]
      >,
    );
    const ownerCandidatePlatformBindingsById = new Map(
      ownerCandidatePlatformBindingEntries as Array<
        [string, Array<{ roleName?: string | null }>]
      >,
    );
    const groupsByMemberId = directoryGroups.reduce<Record<string, any[]>>(
      (acc, group) => {
        (group.members || []).forEach((member: any) => {
          if (!member?.userId) {
            return;
          }
          acc[member.userId] = acc[member.userId] || [];
          acc[member.userId].push(group);
        });
        return acc;
      },
      {},
    );
    const currentUserWorkspaceBindings =
      memberBindingsByUserId.get(validatedSession.user.id) || [];
    const currentUserGroups = (
      groupsByMemberId[validatedSession.user.id] || []
    ).filter(
      (group) => group.status === 'active' && (group.roleKeys || []).length > 0,
    );
    const currentUserPlatformBindings = principalRoleBindingRepository
      ? await principalRoleBindingRepository.findResolvedRoleBindings({
          principalType: 'user',
          principalId: validatedSession.user.id,
          scopeType: 'platform',
          scopeId: PLATFORM_SCOPE_ID,
        })
      : [];

    const workspaceSourceDetails: BindingSourceDetail[] = [];
    if (currentUserWorkspaceBindings.length > 0) {
      workspaceSourceDetails.push({
        kind: 'direct_binding',
        label: toBindingSummaryLabel(
          '直接绑定',
          currentUserWorkspaceBindings.map((binding) => binding.roleName),
        ),
      });
    }
    currentUserGroups.forEach((group) => {
      workspaceSourceDetails.push({
        kind: 'group_binding',
        label: toBindingSummaryLabel(
          `目录组 · ${group.displayName}`,
          group.roleKeys || [],
        ),
      });
    });

    const platformSourceDetails: BindingSourceDetail[] = [];
    if (currentUserPlatformBindings.length > 0) {
      platformSourceDetails.push({
        kind: 'platform_binding',
        label: toBindingSummaryLabel(
          '平台绑定',
          currentUserPlatformBindings.map((binding) => binding.roleName),
        ),
      });
    }

    const membersWithSource = serializedMembers.map((member) => {
      const sourceDetails: BindingSourceDetail[] = [];
      const directBindings = memberBindingsByUserId.get(member.userId) || [];
      if (directBindings.length > 0) {
        sourceDetails.push({
          kind: 'direct_binding',
          label: toBindingSummaryLabel(
            '直接绑定',
            directBindings.map((binding) => binding.roleName),
          ),
        });
      }

      const memberGroups = (groupsByMemberId[member.userId] || []).filter(
        (group) =>
          group.status === 'active' && (group.roleKeys || []).length > 0,
      );
      memberGroups.forEach((group) => {
        sourceDetails.push({
          kind: 'group_binding',
          label: toBindingSummaryLabel(
            `目录组 · ${group.displayName}`,
            group.roleKeys || [],
          ),
        });
      });

      return {
        ...member,
        sourceDetails,
      };
    });
    const reviewQueue = membersWithSource.filter((member) =>
      ['pending', 'invited', 'rejected', 'inactive'].includes(
        String(member.status || '').toLowerCase(),
      ),
    );
    const applications = sortApplications(
      myMemberships
        .filter(
          (membership) => membership.status && membership.status !== 'active',
        )
        .map((membership: any) => ({
          id: membership.id,
          workspaceId: membership.workspaceId,
          workspaceName:
            workspaceById.get(membership.workspaceId)?.name ||
            membership.workspaceId,
          status: membership.status,
          roleKey:
            normalizeWorkspaceRoleKeyForDisplay(membership.roleKey) ||
            'viewer',
          kind:
            workspaceById.get(membership.workspaceId)?.kind ||
            WORKSPACE_KINDS.REGULAR,
          createdAt: membership.createdAt || null,
          updatedAt: membership.updatedAt || null,
        })),
    );

    return res.status(200).json({
      user: {
        id: validatedSession.user.id,
        email: validatedSession.user.email,
        displayName: validatedSession.user.displayName,
        isPlatformAdmin: actor.isPlatformAdmin,
        defaultWorkspaceId: validatedSession.user.defaultWorkspaceId ?? null,
      },
      workspace: {
        ...validatedSession.workspace,
        kind: validatedSession.workspace.kind || WORKSPACE_KINDS.REGULAR,
      },
      membership: {
        ...validatedSession.membership,
        roleKey:
          normalizeWorkspaceRoleKeyForDisplay(
            validatedSession.membership.roleKey,
          ) || 'viewer',
      },
      permissions: {
        canManageMembers,
        canInviteMembers,
        canApproveMembers,
        canManageSchedules,
        canCreateWorkspace,
        actions: permissionActions,
      },
      authorization: {
        actor: {
          ...serializeAuthorizationActor(actor),
          workspaceSourceDetails,
          platformSourceDetails,
        },
      },
      isPlatformAdmin: actor.isPlatformAdmin,
      defaultWorkspaceId: validatedSession.user.defaultWorkspaceId ?? null,
      workspaces: sortByName(workspaces).map(toWorkspaceView),
      discoverableWorkspaces: sortByName(discoverableWorkspaces).map(
        toWorkspaceView,
      ),
      applications,
      ownerCandidates: sortUsers(ownerCandidates).map((candidate) => {
        const platformBindings =
          ownerCandidatePlatformBindingsById.get(candidate.id) || [];
        const isPlatformAdmin = platformBindings.some(
          (binding) =>
            String(binding.roleName || '')
              .trim()
              .toLowerCase() === 'platform_admin',
        );

        return toOwnerCandidateView(candidate, isPlatformAdmin);
      }),
      serviceAccounts: serviceAccounts.map((serviceAccount) => {
        const bindings =
          serviceAccountBindingsById.get(serviceAccount.id) || [];
        const sourceDetails: BindingSourceDetail[] =
          bindings.length > 0
            ? [
                {
                  kind: 'service_account_binding',
                  label: toBindingSummaryLabel(
                    '服务账号绑定',
                    bindings.map((binding) => binding.roleName),
                  ),
                },
              ]
            : [];

        return {
          ...toServiceAccountView(
            serviceAccount,
            apiTokens.filter(
              (token) => token.serviceAccountId === serviceAccount.id,
            ),
          ),
          sourceDetails,
        };
      }),
      apiTokens: apiTokens.map((token) => {
        const serviceAccount = serviceAccounts.find(
          (account) => account.id === token.serviceAccountId,
        );
        return {
          ...toApiTokenView(token),
          sourceDetails: serviceAccount
            ? [
                {
                  kind: 'token_binding',
                  label: `继承服务账号 · ${serviceAccount.name}`,
                },
              ]
            : [],
        };
      }),
      identityProviders,
      accessReviews,
      directoryGroups: directoryGroups.map((group) => ({
        ...toDirectoryGroupView(group),
        sourceDetails: [
          {
            kind: 'group_binding',
            label: toBindingSummaryLabel('目录组绑定', group.roleKeys || []),
          },
        ],
      })),
      breakGlassGrants: breakGlassGrants.map(toBreakGlassGrantView),
      impersonation: {
        active: Boolean(validatedSession.session.impersonatorUserId),
        impersonatorUserId: validatedSession.session.impersonatorUserId || null,
        reason: validatedSession.session.impersonationReason || null,
        canStop: Boolean(validatedSession.session.impersonatorUserId),
      },
      reviewQueue,
      stats: {
        workspaceCount: workspaces.length,
        knowledgeBaseCount: knowledgeBases.filter((item) => !item.archivedAt)
          .length,
        memberCount: members.length,
        reviewQueueCount: reviewQueue.length,
        serviceAccountCount: serviceAccounts.length,
        enterpriseSsoCount: identityProviders.length,
        accessReviewCount: accessReviews.length,
        directoryGroupCount: directoryGroups.length,
        breakGlassGrantCount: breakGlassGrants.filter(
          (grant: any) => !grant.revokedAt && grant.status === 'active',
        ).length,
      },
      members: membersWithSource,
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to load workspace overview';
    const statusCode =
      error?.statusCode ||
      (/permission required/i.test(message)
        ? 403
        : /not found/i.test(message)
          ? 404
          : 400);
    return res.status(statusCode).json({
      error: message,
    });
  }
}
