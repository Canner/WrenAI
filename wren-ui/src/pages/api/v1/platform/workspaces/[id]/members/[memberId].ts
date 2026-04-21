import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  assertAuthorizedWithAudit,
  recordAuditEvent,
  toLegacyWorkspaceRoleKey,
} from '@server/authz';
import {
  assertPlatformActionForContext,
  createHttpError,
  getString,
  requireWorkspaceScopedContext,
} from '@server/api/platform/platformApiUtils';

const SUPPORTED_ACTIONS = [
  'approve',
  'reject',
  'updateRole',
  'deactivate',
  'reactivate',
] as const;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['PATCH', 'DELETE'].includes(String(req.method))) {
    res.setHeader('Allow', 'PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const workspaceId = getString(req.query.id);
    const memberId = getString(req.query.memberId);
    if (!workspaceId || !memberId) {
      throw createHttpError(400, 'Workspace id and member id are required');
    }

    const context = await requireWorkspaceScopedContext({
      req,
      workspaceId,
      platformAction: 'platform.workspace.member.manage',
    });
    const member = await components.workspaceMemberRepository.findOneBy({
      id: memberId,
    });
    if (!member || member.workspaceId !== workspaceId) {
      throw createHttpError(404, 'Workspace member not found');
    }

    if (req.method === 'DELETE') {
      if (context.hasPlatformAccess) {
        await assertPlatformActionForContext({
          context,
          action: 'platform.workspace.member.manage',
          resource: {
            resourceType: 'workspace_member',
            resourceId: member.id,
            workspaceId,
            attributes: {
              workspaceKind: context.workspace.kind || null,
              targetRoleKey: member.roleKey,
              targetUserId: member.userId,
            },
          },
        });
      } else {
        await assertAuthorizedWithAudit({
          auditEventRepository: components.auditEventRepository,
          actor: context.scopedActor,
          action: 'workspace.member.remove',
          resource: {
            resourceType: 'workspace_member',
            resourceId: member.id,
            workspaceId,
            attributes: {
              workspaceKind: context.workspace.kind || null,
              targetRoleKey: member.roleKey,
              targetUserId: member.userId,
            },
          },
          context: context.auditContext,
        });
      }
      await components.workspaceService.removeMember({
        workspaceId,
        memberId: member.id,
        actor: context.hasPlatformAccess ? undefined : context.scopedActor,
      });
      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor: context.hasPlatformAccess ? context.actor : context.scopedActor,
        action: context.hasPlatformAccess
          ? 'platform.workspace.member.manage'
          : 'workspace.member.remove',
        resource: {
          resourceType: 'workspace_member',
          resourceId: member.id,
          workspaceId,
        },
        result: 'succeeded',
        context: context.auditContext,
        beforeJson: member as any,
      });
      return res.status(200).json({ success: true });
    }

    const action = getString(req.body?.action);
    if (
      !SUPPORTED_ACTIONS.includes(action as (typeof SUPPORTED_ACTIONS)[number])
    ) {
      throw createHttpError(400, 'Unsupported member action');
    }

    const authorizationAction =
      action === 'updateRole'
        ? 'workspace.member.role.update'
        : action === 'approve'
          ? 'workspace.member.approve'
          : action === 'reject'
            ? 'workspace.member.reject'
            : 'workspace.member.status.update';

    const roleKey =
      action === 'updateRole'
        ? toLegacyWorkspaceRoleKey(getString(req.body?.roleKey)) || undefined
        : undefined;
    const status =
      action === 'approve' || action === 'reactivate'
        ? 'active'
        : action === 'reject'
          ? 'rejected'
          : action === 'deactivate'
            ? 'inactive'
            : undefined;

    if (context.hasPlatformAccess) {
      await assertPlatformActionForContext({
        context,
        action: 'platform.workspace.member.manage',
        resource: {
          resourceType: 'workspace_member',
          resourceId: member.id,
          workspaceId,
          attributes: {
            workspaceKind: context.workspace.kind || null,
            targetRoleKey: member.roleKey,
            nextRoleKey: roleKey || member.roleKey,
            targetUserId: member.userId,
          },
        },
      });
    } else {
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor: context.scopedActor,
        action: authorizationAction,
        resource: {
          resourceType: 'workspace_member',
          resourceId: member.id,
          workspaceId,
          attributes: {
            workspaceKind: context.workspace.kind || null,
            targetRoleKey: member.roleKey,
            nextRoleKey: roleKey || member.roleKey,
            targetUserId: member.userId,
          },
        },
        context: context.auditContext,
      });
    }

    const updatedMembership = await components.workspaceService.updateMember({
      workspaceId,
      memberId: member.id,
      roleKey,
      status,
      actor: context.hasPlatformAccess ? undefined : context.scopedActor,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor: context.hasPlatformAccess ? context.actor : context.scopedActor,
      action: context.hasPlatformAccess
        ? 'platform.workspace.member.manage'
        : authorizationAction,
      resource: {
        resourceType: 'workspace_member',
        resourceId: member.id,
        workspaceId,
      },
      result: 'succeeded',
      context: context.auditContext,
      beforeJson: member as any,
      afterJson: updatedMembership as any,
      payloadJson: {
        action,
        roleKey: roleKey || null,
        status: status || null,
      },
    });

    return res.status(200).json({ membership: updatedMembership });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to update workspace member',
    });
  }
}
