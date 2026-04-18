import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import { WORKSPACE_KINDS } from '@/utils/workspaceGovernance';
import { PLATFORM_SCOPE_ID, toLegacyWorkspaceRoleKey } from '@server/authz';
import {
  AuthorizationAction,
  assertAuthorizedWithAudit,
  authorize,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  serializeAuthorizationActor,
} from '@server/authz';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

type BindingSourceDetail = {
  kind:
    | 'direct_binding'
    | 'group_binding'
    | 'platform_binding'
    | 'service_account_binding'
    | 'token_binding';
  label: string;
};

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  workspace_owner: '所有者',
  workspace_admin: '管理员',
  workspace_viewer: '成员',
  platform_admin: '平台管理员',
};

const sortByName = <T extends { name?: string | null }>(items: T[]) =>
  [...items].sort((left, right) =>
    String(left.name || '').localeCompare(String(right.name || '')),
  );

const sortUsers = <
  T extends { displayName?: string | null; email?: string | null },
>(
  items: T[],
) =>
  [...items].sort((left, right) => {
    const leftName = left.displayName || left.email || '';
    const rightName = right.displayName || right.email || '';
    return leftName.localeCompare(rightName);
  });

const sortMembers = <
  T extends {
    roleKey?: string | null;
    user?: { displayName?: string | null; email?: string | null } | null;
  },
>(
  items: T[],
) =>
  [...items].sort((left, right) => {
    if (left.roleKey === 'owner' && right.roleKey !== 'owner') {
      return -1;
    }
    if (left.roleKey !== 'owner' && right.roleKey === 'owner') {
      return 1;
    }

    const leftName = left.user?.displayName || left.user?.email || '';
    const rightName = right.user?.displayName || right.user?.email || '';
    return leftName.localeCompare(rightName);
  });

const toWorkspaceView = (workspace: any) => ({
  id: workspace.id,
  name: workspace.name,
  slug: workspace.slug || null,
  status: workspace.status || 'active',
  kind: workspace.kind || WORKSPACE_KINDS.REGULAR,
});

const formatRoleLabel = (roleName?: string | null) => {
  const legacyRole = toLegacyWorkspaceRoleKey(roleName);
  if (legacyRole && ROLE_LABELS[legacyRole]) {
    return ROLE_LABELS[legacyRole];
  }
  return (
    ROLE_LABELS[
      String(roleName || '')
        .trim()
        .toLowerCase()
    ] ||
    roleName ||
    '未知角色'
  );
};

const compactBindingRoles = (roleNames: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      roleNames
        .map((roleName) => String(formatRoleLabel(roleName)).trim())
        .filter(Boolean),
    ),
  );

const toBindingSummaryLabel = (
  prefix: string,
  roleNames: Array<string | null | undefined>,
) => {
  const labels = compactBindingRoles(roleNames);
  return labels.length > 0 ? `${prefix} · ${labels.join(' / ')}` : prefix;
};

const toOwnerCandidateView = (user: any, isPlatformAdmin: boolean) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName ?? null,
  status: user.status || 'active',
  isPlatformAdmin,
});

const toServiceAccountView = (
  serviceAccount: any,
  tokens: Array<any> = [],
) => ({
  id: serviceAccount.id,
  workspaceId: serviceAccount.workspaceId,
  name: serviceAccount.name,
  description: serviceAccount.description || null,
  roleKey: serviceAccount.roleKey,
  status: serviceAccount.status,
  createdBy: serviceAccount.createdBy || null,
  lastUsedAt: serviceAccount.lastUsedAt || null,
  createdAt: serviceAccount.createdAt || null,
  updatedAt: serviceAccount.updatedAt || null,
  tokenCount: tokens.length,
  activeTokenCount: tokens.filter((token) => !token.revokedAt).length,
});

const toApiTokenView = (token: any) => ({
  id: token.id,
  workspaceId: token.workspaceId,
  serviceAccountId: token.serviceAccountId || null,
  name: token.name,
  prefix: token.prefix,
  scopeType: token.scopeType,
  scopeId: token.scopeId,
  status: token.status,
  expiresAt: token.expiresAt || null,
  revokedAt: token.revokedAt || null,
  lastUsedAt: token.lastUsedAt || null,
  createdBy: token.createdBy || null,
  createdAt: token.createdAt || null,
  updatedAt: token.updatedAt || null,
});

const toDirectoryGroupView = (group: any) => ({
  id: group.id,
  workspaceId: group.workspaceId,
  displayName: group.displayName,
  source: group.source,
  status: group.status,
  roleKeys: group.roleKeys || [],
  memberIds: (group.members || []).map((member: any) => member.userId),
  memberCount: Array.isArray(group.members) ? group.members.length : 0,
  createdAt: group.createdAt || null,
  updatedAt: group.updatedAt || null,
});

const toBreakGlassGrantView = (grant: any) => ({
  id: grant.id,
  workspaceId: grant.workspaceId,
  userId: grant.userId,
  roleKey: grant.roleKey,
  status: grant.status,
  reason: grant.reason,
  expiresAt: grant.expiresAt,
  revokedAt: grant.revokedAt || null,
  createdBy: grant.createdBy || null,
  user: grant.user || null,
  createdAt: grant.createdAt || null,
  updatedAt: grant.updatedAt || null,
});

const statusPriority: Record<string, number> = {
  pending: 0,
  invited: 1,
  rejected: 2,
  inactive: 3,
  active: 4,
};

const sortApplications = <
  T extends { status?: string | null; updatedAt?: string | Date | null },
>(
  items: T[],
) =>
  [...items].sort((left, right) => {
    const leftPriority =
      statusPriority[String(left.status || '').toLowerCase()] ?? 99;
    const rightPriority =
      statusPriority[String(right.status || '').toLowerCase()] ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return (
      new Date(right.updatedAt || 0).getTime() -
      new Date(left.updatedAt || 0).getTime()
    );
  });

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
    const evaluateAction = (
      action: AuthorizationAction,
      resource: Parameters<typeof authorize>[0]['resource'],
    ) =>
      authorize({
        actor,
        action,
        resource,
      }).allowed;
    const workspaceResource = {
      resourceType: 'workspace',
      resourceId: validatedSession.workspace.id,
      workspaceId: validatedSession.workspace.id,
      attributes: {
        workspaceKind: validatedSession.workspace.kind || null,
      },
    };
    const canManageMembers = evaluateAction(
      'workspace.member.status.update',
      workspaceResource,
    );
    const canInviteMembers = evaluateAction(
      'workspace.member.invite',
      workspaceResource,
    );
    const canApproveMembers = evaluateAction(
      'workspace.member.approve',
      workspaceResource,
    );
    const canManageSchedules = evaluateAction(
      'workspace.schedule.manage',
      workspaceResource,
    );
    const canCreateWorkspace = evaluateAction('workspace.create', {
      resourceType: 'workspace',
      resourceId: 'new',
      workspaceId: actor.workspaceId || validatedSession.workspace.id,
    });
    const permissionActions = {
      'workspace.create': canCreateWorkspace,
      'workspace.default.set': evaluateAction('workspace.default.set', {
        resourceType: 'workspace',
        resourceId: validatedSession.user.defaultWorkspaceId || 'self',
        ownerUserId: validatedSession.user.id,
      }),
      'workspace.member.invite': canInviteMembers,
      'workspace.member.approve': canApproveMembers,
      'workspace.member.status.update': canManageMembers,
      'workspace.member.role.update': evaluateAction(
        'workspace.member.role.update',
        workspaceResource,
      ),
      'workspace.member.remove': evaluateAction(
        'workspace.member.remove',
        workspaceResource,
      ),
      'workspace.schedule.manage': canManageSchedules,
      'knowledge_base.create': evaluateAction('knowledge_base.create', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'connector.create': evaluateAction('connector.create', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'skill.create': evaluateAction('skill.create', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
      }),
      'secret.reencrypt': evaluateAction('secret.reencrypt', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
      }),
      'service_account.read': evaluateAction('service_account.read', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'service_account.create': evaluateAction('service_account.create', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'service_account.update': evaluateAction('service_account.update', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'service_account.delete': evaluateAction('service_account.delete', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'api_token.read': evaluateAction('api_token.read', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'api_token.create': evaluateAction('api_token.create', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'api_token.revoke': evaluateAction('api_token.revoke', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'identity_provider.read': evaluateAction('identity_provider.read', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'identity_provider.manage': evaluateAction('identity_provider.manage', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'access_review.read': evaluateAction('access_review.read', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'access_review.manage': evaluateAction('access_review.manage', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'group.read': evaluateAction('group.read', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'group.manage': evaluateAction('group.manage', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'audit.read': evaluateAction('audit.read', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'role.read': evaluateAction('role.read', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'role.manage': evaluateAction('role.manage', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      }),
      'break_glass.manage': evaluateAction('break_glass.manage', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
      }),
      'impersonation.start': evaluateAction('impersonation.start', {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
      }),
    };
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
          roleKey: membership.roleKey,
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
      membership: validatedSession.membership,
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
