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
  serializeMembership,
  sortMemberships,
} from '../../../platformApiUtils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'POST'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, POST');
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
      platformAction: 'platform.workspace.member.manage',
    });

    if (req.method === 'POST') {
      const roleKey =
        toLegacyWorkspaceRoleKey(getString(req.body?.roleKey) || 'viewer') ||
        'member';
      const email = getString(req.body?.email).toLowerCase();
      const userId = getString(req.body?.userId);
      if (!email && !userId) {
        throw createHttpError(400, 'email or userId is required');
      }

      if (context.hasPlatformAccess) {
        await assertPlatformActionForContext({
          context,
          action: 'platform.workspace.member.manage',
          resource: {
            resourceType: 'workspace',
            resourceId: workspaceId,
            workspaceId,
            attributes: {
              workspaceKind: context.workspace.kind || null,
              nextRoleKey: roleKey,
              targetUserId: userId || null,
            },
          },
        });
      } else {
        await assertAuthorizedWithAudit({
          auditEventRepository: components.auditEventRepository,
          actor: context.scopedActor,
          action: 'workspace.member.invite',
          resource: {
            resourceType: 'workspace',
            resourceId: workspaceId,
            workspaceId,
            attributes: {
              workspaceKind: context.workspace.kind || null,
              nextRoleKey: roleKey,
              targetUserId: userId || null,
            },
          },
          context: context.auditContext,
        });
      }

      const membership = userId
        ? await components.workspaceService.addMember({
            workspaceId,
            userId,
            roleKey,
            status: 'active',
          })
        : await components.workspaceService.inviteMemberByEmail({
            workspaceId,
            email,
            roleKey,
            status: 'invited',
            actor: context.hasPlatformAccess ? undefined : context.scopedActor,
          });

      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor: context.hasPlatformAccess ? context.actor : context.scopedActor,
        action: context.hasPlatformAccess
          ? 'platform.workspace.member.manage'
          : 'workspace.member.invite',
        resource: {
          resourceType: 'workspace_member',
          resourceId: membership.id,
          workspaceId,
        },
        result: 'succeeded',
        context: context.auditContext,
        afterJson: membership as any,
        payloadJson: {
          email: email || null,
          userId: userId || null,
          roleKey,
        },
      });
    }

    const [members, users] = await Promise.all([
      components.workspaceMemberRepository.findAllBy(
        { workspaceId },
        { order: 'created_at asc' },
      ),
      components.userRepository.findAll({
        order: 'display_name asc, email asc',
      }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));

    return res.status(200).json({
      members: sortMemberships(
        members.map((member) =>
          serializeMembership({
            membership: member,
            user: userById.get(member.userId) || null,
            workspace: context.workspace,
          }),
        ),
      ),
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to load workspace members',
    });
  }
}
