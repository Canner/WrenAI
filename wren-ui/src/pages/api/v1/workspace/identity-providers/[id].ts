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
    const id = getQueryString(req.query.id);
    if (!id) {
      return res
        .status(400)
        .json({ error: 'identity provider id is required' });
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
    const providers = await components.identityProviderService.listProviders(
      validatedSession.workspace.id,
    );
    const provider = providers.find((item) => item.id === id);
    if (!provider) {
      return res.status(404).json({ error: 'Identity provider not found' });
    }

    const resource = {
      resourceType: 'identity_provider',
      resourceId: provider.id,
      workspaceId: validatedSession.workspace.id,
      attributes: {
        workspaceKind: validatedSession.workspace.kind || null,
      },
    };

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'identity_provider.manage',
      resource,
      context: auditContext,
    });

    if (req.method === 'DELETE') {
      await components.identityProviderService.deleteProvider(
        validatedSession.workspace.id,
        provider.id,
      );

      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'identity_provider.manage',
        resource,
        result: 'succeeded',
        context: auditContext,
        beforeJson: provider as any,
      });

      return res.status(200).json({ ok: true });
    }

    const updated = await components.identityProviderService.updateProvider({
      workspaceId: validatedSession.workspace.id,
      id: provider.id,
      name: getString(req.body?.name) || undefined,
      enabled:
        req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled),
      configJson:
        req.body?.configJson === undefined ? undefined : req.body.configJson,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'identity_provider.manage',
      resource,
      result: 'succeeded',
      context: auditContext,
      beforeJson: provider as any,
      afterJson: updated as any,
    });

    return res.status(200).json({ identityProvider: updated });
  } catch (error: any) {
    const message = error?.message || 'Failed to update identity provider';
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
