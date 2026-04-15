import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const toGrantView = (grant: any) => ({
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const workspaceId = getQueryString(req.query.workspaceId);
    const id = getQueryString(req.query.id);
    if (!id) {
      return res
        .status(400)
        .json({ error: 'break-glass grant id is required' });
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
    const workspaceResource = {
      resourceType: 'workspace',
      resourceId: validatedSession.workspace.id,
      workspaceId: validatedSession.workspace.id,
      attributes: { workspaceKind: validatedSession.workspace.kind || null },
    };

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'break_glass.manage',
      resource: workspaceResource,
      context: auditContext,
    });

    const grant = await components.governanceService.revokeBreakGlassGrant({
      validatedSession,
      id,
    });
    const serialized = toGrantView(grant);

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'break_glass.manage',
      resource: {
        resourceType: 'break_glass_grant',
        resourceId: grant.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      afterJson: serialized as any,
    });

    return res.status(200).json({ breakGlassGrant: serialized });
  } catch (error: any) {
    const message = error?.message || 'Failed to revoke break-glass grant';
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
