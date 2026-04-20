import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { recordAuditEvent, toLegacyWorkspaceRoleKey } from '@server/authz';
import {
  buildPlatformUserRecord,
  createHttpError,
  getString,
  listPlatformRoleAssignments,
  requirePlatformActionContext,
  serializeMembership,
  sortWorkspacesByName,
} from '../../platformApiUtils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'POST', 'PATCH'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = getString(req.query.id);
    if (!id) {
      throw createHttpError(400, 'User id is required');
    }

    const user = await components.userRepository.findOneBy({ id });
    if (!user) {
      throw createHttpError(404, 'User not found');
    }

    if (req.method === 'POST') {
      const context = await requirePlatformActionContext({
        req,
        action: 'platform.user.workspace.assign',
      });
      const workspaceId = getString(req.body?.workspaceId);
      const roleKey =
        toLegacyWorkspaceRoleKey(getString(req.body?.roleKey) || 'viewer') ||
        'member';
      if (!workspaceId) {
        throw createHttpError(400, 'workspaceId is required');
      }
      const workspace = await components.workspaceRepository.findOneBy({
        id: workspaceId,
      });
      if (!workspace) {
        throw createHttpError(404, 'Workspace not found');
      }
      const membership = await components.workspaceService.addMember({
        workspaceId,
        userId: id,
        roleKey,
        status: 'active',
      });

      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor: context.actor,
        action: 'platform.user.workspace.assign',
        resource: {
          resourceType: 'workspace_member',
          resourceId: membership.id,
          workspaceId,
        },
        result: 'succeeded',
        context: context.auditContext,
        afterJson: membership as any,
        payloadJson: { userId: id, roleKey },
      });
    }

    if (req.method === 'PATCH') {
      const context = await requirePlatformActionContext({
        req,
        action: 'platform.user.workspace.assign',
      });
      const membershipId = getString(req.body?.membershipId);
      const workspaceId = getString(req.body?.workspaceId);
      const action = getString(req.body?.action);
      if (!membershipId || !workspaceId || !action) {
        throw createHttpError(
          400,
          'membershipId, workspaceId and action are required',
        );
      }
      const membership = await components.workspaceMemberRepository.findOneBy({
        id: membershipId,
      });
      if (
        !membership ||
        membership.userId !== id ||
        membership.workspaceId !== workspaceId
      ) {
        throw createHttpError(404, 'Workspace membership not found');
      }
      const workspace = await components.workspaceRepository.findOneBy({
        id: workspaceId,
      });
      if (!workspace) {
        throw createHttpError(404, 'Workspace not found');
      }
      if (action === 'remove') {
        await components.workspaceService.removeMember({
          workspaceId,
          memberId: membership.id,
        });
        await recordAuditEvent({
          auditEventRepository: components.auditEventRepository,
          actor: context.actor,
          action: 'platform.user.workspace.assign',
          resource: {
            resourceType: 'workspace_member',
            resourceId: membership.id,
            workspaceId,
          },
          result: 'succeeded',
          context: context.auditContext,
          beforeJson: membership as any,
        });
      } else {
        const requestedRoleKey =
          getString(req.body?.roleKey) || membership.roleKey;
        const roleKey = toLegacyWorkspaceRoleKey(requestedRoleKey) || undefined;
        const updatedMembership =
          await components.workspaceService.updateMember({
            workspaceId,
            memberId: membership.id,
            roleKey,
          });
        await recordAuditEvent({
          auditEventRepository: components.auditEventRepository,
          actor: context.actor,
          action: 'platform.user.workspace.assign',
          resource: {
            resourceType: 'workspace_member',
            resourceId: membership.id,
            workspaceId,
          },
          result: 'succeeded',
          context: context.auditContext,
          beforeJson: membership as any,
          afterJson: updatedMembership as any,
          payloadJson: { roleKey: roleKey || membership.roleKey },
        });
      }
    }

    if (req.method === 'GET') {
      await requirePlatformActionContext({
        req,
        action: 'platform.user.read',
      });
    }

    const [workspaces, memberships, platformRoleData] = await Promise.all([
      components.workspaceRepository.findAllBy(
        { status: 'active' },
        { order: 'name asc' },
      ),
      components.workspaceMemberRepository.findAllBy(
        { userId: id },
        { order: 'created_at asc' },
      ),
      listPlatformRoleAssignments(),
    ]);
    const workspaceById = new Map(
      workspaces.map((workspace) => [workspace.id, workspace]),
    );

    return res.status(200).json({
      user: buildPlatformUserRecord({
        user,
        memberships,
        workspaceById,
        platformRoles: platformRoleData.platformRolesByUserId.get(id) || [],
        platformAdminFallbackRole: platformRoleData.platformAdminRole,
      }),
      platformRoleCatalog: platformRoleData.platformRoleCatalog,
      memberships: memberships.map((membership) =>
        serializeMembership({
          membership,
          workspace: workspaceById.get(membership.workspaceId) || null,
          user,
        }),
      ),
      availableWorkspaces: sortWorkspacesByName(
        workspaces.filter(
          (workspace) =>
            !memberships.some(
              (membership) => membership.workspaceId === workspace.id,
            ),
        ),
      ).map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        kind: workspace.kind || 'regular',
      })),
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to load user workspaces',
    });
  }
}
