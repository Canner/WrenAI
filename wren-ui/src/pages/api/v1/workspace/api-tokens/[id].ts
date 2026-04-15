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
    const tokenId = getQueryString(req.query.id);
    if (!tokenId) {
      return res.status(400).json({ error: 'token id is required' });
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

    const tokens = await components.automationService.listApiTokens({
      workspaceId: validatedSession.workspace.id,
    });
    const token = tokens.find((item) => item.id === tokenId);
    if (!token) {
      return res.status(404).json({ error: 'API token not found' });
    }

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'api_token.revoke',
      resource: {
        resourceType: 'api_token',
        resourceId: token.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      },
      context: auditContext,
    });

    const revoked = await components.automationService.revokeApiToken({
      workspaceId: validatedSession.workspace.id,
      tokenId: token.id,
      revokedBy: validatedSession.user.id,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'api_token.revoke',
      resource: {
        resourceType: 'api_token',
        resourceId: token.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      beforeJson: sanitizeApiToken(token),
      afterJson: sanitizeApiToken(revoked),
    });

    return res.status(200).json({
      token: sanitizeApiToken(revoked),
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to revoke API token';
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
