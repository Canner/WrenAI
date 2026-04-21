import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  recordAuditEvent,
} from '@server/authz';
import {
  canManageWorkspaceMemberships,
  createHttpError,
  getString,
  hasPlatformAction,
  requireValidatedPlatformSession,
  serializeMembership,
  serializeWorkspace,
  serializeWorkspaceRoleKey,
  sortWorkspacesByName,
} from '@server/api/platform/platformApiUtils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'POST'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const context = await requireValidatedPlatformSession(req);
    const currentActor = buildAuthorizationActorFromValidatedSession(
      context.validatedSession,
    );
    const canReadAllWorkspaces = hasPlatformAction({
      actor: currentActor,
      action: 'platform.workspace.read',
      workspaceId:
        currentActor.workspaceId || context.validatedSession.workspace.id,
    });
    const canManageWorkspaceMembersFromPlatform = hasPlatformAction({
      actor: currentActor,
      action: 'platform.workspace.member.manage',
      workspaceId:
        currentActor.workspaceId || context.validatedSession.workspace.id,
    });

    if (req.method === 'POST') {
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor: currentActor,
        action: 'workspace.create',
        resource: {
          resourceType: 'workspace',
          resourceId: 'new',
          workspaceId:
            currentActor.workspaceId || context.validatedSession.workspace.id,
        },
        context: context.auditContext,
      });

      const name = getString(req.body?.name);
      const slug = getString(req.body?.slug) || undefined;
      const initialOwnerUserId = getString(req.body?.initialOwnerUserId);
      if (!name || !initialOwnerUserId) {
        throw createHttpError(400, 'name and initialOwnerUserId are required');
      }

      const workspace = await components.workspaceService.createWorkspace({
        name,
        slug,
        createdBy: context.validatedSession.user.id,
        initialOwnerUserId,
        actor: currentActor,
      });

      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor: currentActor,
        action: 'workspace.create',
        resource: {
          resourceType: 'workspace',
          resourceId: workspace.id,
          workspaceId: workspace.id,
        },
        result: 'succeeded',
        context: context.auditContext,
        afterJson: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug || null,
          initialOwnerUserId,
        },
      });
    }

    const isPlatformAdmin = currentActor.isPlatformAdmin;
    const [allWorkspaces, allMemberships, accessibleWorkspaces, allUsers] =
      await Promise.all([
        components.workspaceRepository.findAllBy(
          { status: 'active' },
          { order: 'name asc' },
        ),
        components.workspaceMemberRepository.findAll({
          order: 'workspace_id asc, created_at asc',
        }),
        components.workspaceService.listWorkspacesForUser(
          context.validatedSession.user.id,
        ),
        components.userRepository.findAll({
          order: 'display_name asc, email asc',
        }),
      ]);

    const visibleWorkspaces = sortWorkspacesByName(
      canReadAllWorkspaces || isPlatformAdmin
        ? allWorkspaces
        : accessibleWorkspaces,
    );
    const visibleWorkspaceIds = new Set(
      visibleWorkspaces.map((workspace) => workspace.id),
    );
    const memberships = allMemberships.filter((membership) =>
      visibleWorkspaceIds.has(membership.workspaceId),
    );
    const membershipsByWorkspaceId = memberships.reduce<Map<string, any[]>>(
      (acc, membership) => {
        const entries = acc.get(membership.workspaceId) || [];
        entries.push(membership);
        acc.set(membership.workspaceId, entries);
        return acc;
      },
      new Map(),
    );
    const userById = new Map(allUsers.map((user) => [user.id, user]));
    const selfMembershipByWorkspaceId = new Map(
      allMemberships
        .filter(
          (membership) =>
            membership.userId === context.validatedSession.user.id,
        )
        .map((membership) => [membership.workspaceId, membership]),
    );

    const workspaces = await Promise.all(
      visibleWorkspaces.map(async (workspace) => {
        const workspaceMemberships =
          membershipsByWorkspaceId.get(workspace.id) || [];
        const actorMembership = selfMembershipByWorkspaceId.get(workspace.id);
        const [knowledgeBases, connectors, skills] = await Promise.all([
          components.knowledgeBaseRepository.findAllBy({
            workspaceId: workspace.id,
          }),
          components.connectorRepository.findAllBy({
            workspaceId: workspace.id,
          }),
          components.skillDefinitionRepository.findAllBy({
            workspaceId: workspace.id,
          }),
        ]);
        return {
          ...serializeWorkspace(workspace),
          memberCount: workspaceMemberships.filter(
            (membership) => membership.status === 'active',
          ).length,
          ownerCount: workspaceMemberships.filter(
            (membership) =>
              membership.status === 'active' &&
              serializeWorkspaceRoleKey(membership.roleKey) === 'owner',
          ).length,
          viewerCount: workspaceMemberships.filter(
            (membership) =>
              membership.status === 'active' &&
              serializeWorkspaceRoleKey(membership.roleKey) === 'viewer',
          ).length,
          pendingCount: workspaceMemberships.filter(
            (membership) => membership.status === 'pending',
          ).length,
          canManageMembers:
            isPlatformAdmin ||
            canManageWorkspaceMembersFromPlatform ||
            canManageWorkspaceMemberships(actorMembership?.roleKey),
          actorRoleKey: actorMembership
            ? serializeWorkspaceRoleKey(actorMembership.roleKey)
            : null,
          resourceSummary: {
            knowledgeBaseCount: knowledgeBases.filter(
              (item) => !item.archivedAt,
            ).length,
            connectorCount: connectors.length,
            skillCount: skills.length,
          },
        };
      }),
    );

    const applications = memberships
      .filter((membership) => membership.status === 'pending')
      .filter((membership) => {
        if (isPlatformAdmin) {
          return true;
        }
        if (canManageWorkspaceMembersFromPlatform) {
          return true;
        }
        if (canReadAllWorkspaces) {
          return true;
        }
        const actorMembership = selfMembershipByWorkspaceId.get(
          membership.workspaceId,
        );
        return canManageWorkspaceMemberships(actorMembership?.roleKey);
      })
      .map((membership) =>
        serializeMembership({
          membership,
          user: userById.get(membership.userId) || null,
          workspace:
            visibleWorkspaces.find(
              (workspace) => workspace.id === membership.workspaceId,
            ) || null,
        }),
      );

    return res.status(200).json({
      workspaces,
      applications,
      ownerCandidates: allUsers
        .filter((user) => user.status === 'active')
        .map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName || null,
        })),
      currentWorkspaceId: context.validatedSession.workspace.id,
      isPlatformAdmin,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to load workspaces',
    });
  }
}
