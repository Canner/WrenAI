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

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const sanitizeApiToken = (token: any) => ({
  id: token.id,
  workspaceId: token.workspaceId,
  serviceAccountId: token.serviceAccountId || null,
  name: token.name,
  prefix: token.prefix,
  scopeType: token.scopeType,
  scopeId: token.scopeId,
  status: token.status,
  expiresAt: token.expiresAt || null,
  revokedAt: token.revokedAt || null,
  lastUsedAt: token.lastUsedAt || null,
  createdBy: token.createdBy || null,
  createdAt: token.createdAt || null,
  updatedAt: token.updatedAt || null,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'POST'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const workspaceId = getQueryString(req.query.workspaceId);
    const serviceAccountId = getQueryString(req.query.id);
    if (!serviceAccountId) {
      return res.status(400).json({ error: 'service account id is required' });
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
    const resource = {
      resourceType: 'service_account',
      resourceId: serviceAccountId,
      workspaceId: validatedSession.workspace.id,
      attributes: {
        workspaceKind: validatedSession.workspace.kind || null,
      },
    };

    if (req.method === 'GET') {
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'api_token.read',
        resource,
        context: auditContext,
      });

      const tokens = await components.automationService.listApiTokens({
        workspaceId: validatedSession.workspace.id,
        serviceAccountId,
      });

      return res.status(200).json({
        tokens: tokens.map(sanitizeApiToken),
      });
    }

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'api_token.create',
      resource,
      context: auditContext,
    });

    const name = getString(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const created = await components.automationService.createApiToken({
      workspaceId: validatedSession.workspace.id,
      serviceAccountId,
      name,
      expiresAt: req.body?.expiresAt || undefined,
      createdBy: validatedSession.user.id,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'api_token.create',
      resource: {
        resourceType: 'api_token',
        resourceId: created.token.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      afterJson: sanitizeApiToken(created.token),
      payloadJson: {
        serviceAccountId,
      },
    });

    return res.status(201).json({
      token: sanitizeApiToken(created.token),
      plainTextToken: created.plainTextToken,
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to manage API tokens';
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
