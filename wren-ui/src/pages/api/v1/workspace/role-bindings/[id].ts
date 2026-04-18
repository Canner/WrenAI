import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  deleteWorkspaceRoleBinding,
  recordAuditEvent,
} from '@server/authz';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const workspaceId = getQueryString(req.query.workspaceId);
    const bindingId = getQueryString(req.query.id);
    if (!bindingId) {
      return res.status(400).json({ error: 'binding id is required' });
    }
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

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'role.manage',
      resource: {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      },
      context: auditContext,
    });

    const deleted = await deleteWorkspaceRoleBinding({
      workspaceId: validatedSession.workspace.id,
      bindingId,
      roleRepository: components.roleRepository,
      principalRoleBindingRepository: components.principalRoleBindingRepository,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'role.manage',
      resource: {
        resourceType: 'role_binding',
        resourceId: bindingId,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      beforeJson: deleted.binding as any,
      payloadJson: {
        roleName: deleted.role.name,
      },
    });

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    const message = error?.message || 'Failed to delete role binding';
    const statusCode =
      error?.statusCode ||
      (/permission required/i.test(message)
        ? 403
        : /not found/i.test(message)
          ? 404
          : 400);
    return res.status(statusCode).json({ error: message });
  }
}
