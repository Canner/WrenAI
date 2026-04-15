import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
  searchWorkspaceAuditEvents,
} from '@server/authz';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'audit.read',
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

    const events = await searchWorkspaceAuditEvents({
      workspaceId: validatedSession.workspace.id,
      preset: getQueryString(req.query.preset) || null,
      action: getQueryString(req.query.action) || undefined,
      actorType: getQueryString(req.query.actorType) || undefined,
      actorId: getQueryString(req.query.actorId) || undefined,
      resourceType: getQueryString(req.query.resourceType) || undefined,
      resourceId: getQueryString(req.query.resourceId) || undefined,
      result: getQueryString(req.query.result) || undefined,
      query: getQueryString(req.query.query) || undefined,
      limit: Number.parseInt(getQueryString(req.query.limit) || '50', 10),
      auditEventRepository: components.auditEventRepository,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'audit.read',
      resource: {
        resourceType: 'audit_event',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'allowed',
      context: auditContext,
      payloadJson: {
        action: getQueryString(req.query.action) || null,
        actorType: getQueryString(req.query.actorType) || null,
        actorId: getQueryString(req.query.actorId) || null,
        resourceType: getQueryString(req.query.resourceType) || null,
        resourceId: getQueryString(req.query.resourceId) || null,
        result: getQueryString(req.query.result) || null,
        preset: getQueryString(req.query.preset) || null,
      },
    });

    return res.status(200).json({ events });
  } catch (error: any) {
    const message = error?.message || 'Failed to query audit events';
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
