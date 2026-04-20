import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { assertAuthorizedWithAudit } from '@server/authz';
import {
  assertPlatformActionForContext,
  canManageWorkspaceMemberships,
  createHttpError,
  getString,
  hasPlatformAction,
  requireWorkspaceScopedContext,
  serializeMembership,
  serializeWorkspace,
  serializeWorkspaceRoleKey,
  sortMemberships,
} from '../platformApiUtils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const workspaceId = getString(req.query.id);
    if (!workspaceId) {
      throw createHttpError(400, 'Workspace id is required');
    }

    const context = await requireWorkspaceScopedContext({
      req,
      workspaceId,
      platformAction: 'platform.workspace.read',
    });
    if (context.hasPlatformAccess) {
      await assertPlatformActionForContext({
        context,
        action: 'platform.workspace.read',
        resource: {
          resourceType: 'workspace',
          resourceId: workspaceId,
          workspaceId,
          attributes: {
            workspaceKind: context.workspace.kind || null,
          },
        },
      });
    } else {
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor: context.scopedActor,
        action: 'workspace.read',
        resource: {
          resourceType: 'workspace',
          resourceId: workspaceId,
          workspaceId,
          attributes: {
            workspaceKind: context.workspace.kind || null,
          },
        },
        context: context.auditContext,
      });
    }

    const [members, users, knowledgeBases, connectors, skills] =
      await Promise.all([
        components.workspaceMemberRepository.findAllBy(
          { workspaceId },
          { order: 'created_at asc' },
        ),
        components.userRepository.findAll({
          order: 'display_name asc, email asc',
        }),
        components.knowledgeBaseRepository.findAllBy({ workspaceId }),
        components.connectorRepository.findAllBy({ workspaceId }),
        components.skillDefinitionRepository.findAllBy({ workspaceId }),
      ]);

    const userById = new Map(users.map((user) => [user.id, user]));
    const canManageMembersFromPlatform = hasPlatformAction({
      actor: context.actor,
      action: 'platform.workspace.member.manage',
      workspaceId,
    });
    const memberViews = sortMemberships(
      members.map((member) =>
        serializeMembership({
          membership: member,
          user: userById.get(member.userId) || null,
          workspace: context.workspace,
        }),
      ),
    );

    return res.status(200).json({
      workspace: {
        ...serializeWorkspace(context.workspace),
        memberCount: members.filter((member) => member.status === 'active')
          .length,
        ownerCount: members.filter(
          (member) =>
            member.status === 'active' &&
            serializeWorkspaceRoleKey(member.roleKey) === 'owner',
        ).length,
        viewerCount: members.filter(
          (member) =>
            member.status === 'active' &&
            serializeWorkspaceRoleKey(member.roleKey) !== 'owner',
        ).length,
        pendingCount: members.filter((member) => member.status === 'pending')
          .length,
        resourceSummary: {
          knowledgeBaseCount: knowledgeBases.filter((item) => !item.archivedAt)
            .length,
          connectorCount: connectors.length,
          skillCount: skills.length,
        },
      },
      permissions: {
        canManageMembers:
          canManageMembersFromPlatform ||
          context.scopedActor.isPlatformAdmin ||
          canManageWorkspaceMemberships(context.membership?.roleKey),
      },
      members: memberViews,
      ownerCandidates: users
        .filter((user) => user.status === 'active')
        .map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName || null,
        })),
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to load workspace detail',
    });
  }
}
