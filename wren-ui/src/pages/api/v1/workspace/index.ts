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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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

    const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor.sessionId,
    });
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.create',
      resource: {
        resourceType: 'workspace',
        resourceId: 'new',
        workspaceId: actor.workspaceId || validatedSession.workspace.id,
      },
      context: auditContext,
    });

    const name = getString(req.body?.name);
    const slug = getString(req.body?.slug) || undefined;
    const initialOwnerUserId = getString(req.body?.initialOwnerUserId);

    if (!name || !initialOwnerUserId) {
      return res.status(400).json({
        error: 'name and initialOwnerUserId are required',
      });
    }

    const workspace = await components.workspaceService.createWorkspace({
      name,
      slug,
      createdBy: validatedSession.user.id,
      initialOwnerUserId,
      actor,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.create',
      resource: {
        resourceType: 'workspace',
        resourceId: workspace.id,
        workspaceId: workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      afterJson: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug || null,
        createdBy: workspace.createdBy || null,
        initialOwnerUserId,
      },
    });

    return res.status(201).json({ workspace });
  } catch (error: any) {
    const message = error?.message || 'Failed to create workspace';
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
