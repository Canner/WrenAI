import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
  toLegacyWorkspaceRoleKey,
} from '@server/authz';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const VALID_MEMBER_ROLES = ['owner', 'viewer', 'admin', 'member'];

const ensureScopedMembership = async (id: string, workspaceId: string) => {
  const member = await components.workspaceMemberRepository.findOneBy({ id });
  if (!member || member.workspaceId !== workspaceId) {
    throw new Error('Workspace member not found');
  }

  return member;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['PATCH', 'DELETE'].includes(String(req.method))) {
    res.setHeader('Allow', 'PATCH, DELETE');
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
    const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor.sessionId,
    });

    const id = getQueryString(req.query.id);
    if (!id) {
      return res.status(400).json({ error: 'Workspace member id is required' });
    }

    const member = await ensureScopedMembership(
      id,
      validatedSession.workspace.id,
    );
    const actorUserId = validatedSession.user.id;

    if (member.userId === actorUserId && req.method === 'DELETE') {
      return res.status(400).json({
        error: 'You cannot remove yourself from the current workspace',
      });
    }

    if (req.method === 'DELETE') {
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'workspace.member.remove',
        resource: {
          resourceType: 'workspace_member',
          resourceId: member.id,
          workspaceId: validatedSession.workspace.id,
          attributes: {
            workspaceKind: validatedSession.workspace.kind || null,
            targetRoleKey: member.roleKey,
            targetUserId: member.userId,
          },
        },
        context: auditContext,
      });
      await components.workspaceService.removeMember({
        workspaceId: validatedSession.workspace.id,
        memberId: member.id,
        actor,
      });
      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'workspace.member.remove',
        resource: {
          resourceType: 'workspace_member',
          resourceId: member.id,
          workspaceId: validatedSession.workspace.id,
        },
        result: 'succeeded',
        context: auditContext,
        beforeJson: member as any,
      });
      return res.status(200).json({ success: true });
    }

    const action = getString(req.body?.action);
    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    if (
      !['approve', 'reject', 'updateRole', 'deactivate', 'reactivate'].includes(
        action,
      )
    ) {
      return res.status(400).json({ error: 'Unsupported member action' });
    }

    if (
      ['reject', 'deactivate'].includes(action) &&
      member.userId === actorUserId
    ) {
      return res
        .status(400)
        .json({ error: 'You cannot change your own member status here' });
    }

    const patch: { roleKey?: string; status?: string } = {};
    if (action === 'approve' || action === 'reactivate') {
      patch.status = 'active';
    }
    if (action === 'reject') {
      patch.status = 'rejected';
    }
    if (action === 'deactivate') {
      patch.status = 'inactive';
    }
    if (action === 'updateRole') {
      const requestedRoleKey = getString(req.body?.roleKey).toLowerCase();
      if (!VALID_MEMBER_ROLES.includes(requestedRoleKey)) {
        return res.status(400).json({ error: 'Unsupported roleKey' });
      }
      patch.roleKey = toLegacyWorkspaceRoleKey(requestedRoleKey) || undefined;
    }
    const authorizationAction =
      action === 'updateRole'
        ? 'workspace.member.role.update'
        : action === 'approve' || action === 'reject'
          ? action === 'approve'
            ? 'workspace.member.approve'
            : 'workspace.member.reject'
          : 'workspace.member.status.update';

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: authorizationAction,
      resource: {
        resourceType: 'workspace_member',
        resourceId: member.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
          targetRoleKey: member.roleKey,
          nextRoleKey: patch.roleKey || member.roleKey,
          targetUserId: member.userId,
        },
      },
      context: auditContext,
    });

    const updatedMember = await components.workspaceService.updateMember({
      workspaceId: validatedSession.workspace.id,
      memberId: member.id,
      roleKey: patch.roleKey,
      status: patch.status,
      actor,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: authorizationAction,
      resource: {
        resourceType: 'workspace_member',
        resourceId: member.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      beforeJson: member as any,
      afterJson: updatedMember as any,
      payloadJson: {
        action,
      },
    });

    return res.status(200).json({ membership: updatedMember });
  } catch (error: any) {
    const message = error?.message || 'Failed to update workspace member';
    const statusCode =
      error?.statusCode ||
      (message === 'Workspace member not found'
        ? 404
        : /permission required/i.test(message)
          ? 403
          : 400);
    return res.status(statusCode).json({ error: message });
  }
}
