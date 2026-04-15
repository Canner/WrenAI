import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

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

    const validatedSession =
      await components.authService.validateSession(sessionToken);
    if (!validatedSession) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const defaultWorkspaceId = getString(req.body?.defaultWorkspaceId);
    if (!defaultWorkspaceId) {
      return res.status(400).json({ error: 'defaultWorkspaceId is required' });
    }

    const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor.sessionId,
    });
    const targetWorkspace = await components.workspaceRepository.findOneBy({
      id: defaultWorkspaceId,
    });

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.default.set',
      resource: {
        resourceType: 'workspace',
        resourceId: defaultWorkspaceId,
        ownerUserId: validatedSession.user.id,
      },
      context: auditContext,
    });

    await components.workspaceService.updateDefaultWorkspace({
      validatedSession,
      defaultWorkspaceId,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.default.set',
      resource: {
        resourceType: 'workspace',
        resourceId: defaultWorkspaceId,
        workspaceId: targetWorkspace?.id || actor.workspaceId || null,
      },
      result: 'succeeded',
      context: auditContext,
      beforeJson: {
        defaultWorkspaceId: validatedSession.user.defaultWorkspaceId ?? null,
      },
      afterJson: {
        defaultWorkspaceId,
      },
    });

    return res.status(200).json({
      ok: true,
      defaultWorkspaceId,
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to update workspace preferences';
    const statusCode =
      error?.statusCode ||
      (/authentication/i.test(message)
        ? 401
        : /required/i.test(message)
          ? 400
          : /not found/i.test(message)
            ? 404
            : 400);
    return res.status(statusCode).json({ error: message });
  }
}
