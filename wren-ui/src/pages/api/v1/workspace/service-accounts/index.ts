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

const sanitizeServiceAccount = (serviceAccount: any) => ({
  id: serviceAccount.id,
  workspaceId: serviceAccount.workspaceId,
  name: serviceAccount.name,
  description: serviceAccount.description || null,
  roleKey: serviceAccount.roleKey,
  status: serviceAccount.status,
  createdBy: serviceAccount.createdBy || null,
  lastUsedAt: serviceAccount.lastUsedAt || null,
  createdAt: serviceAccount.createdAt || null,
  updatedAt: serviceAccount.updatedAt || null,
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
      attributes: {
        workspaceKind: validatedSession.workspace.kind || null,
      },
    };

    if (req.method === 'GET') {
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'service_account.read',
        resource: workspaceResource,
        context: auditContext,
      });

      const serviceAccounts =
        await components.automationService.listServiceAccounts(
          validatedSession.workspace.id,
        );

      return res.status(200).json({
        serviceAccounts: serviceAccounts.map(sanitizeServiceAccount),
      });
    }

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'service_account.create',
      resource: workspaceResource,
      context: auditContext,
    });

    const name = getString(req.body?.name);
    const description = getString(req.body?.description) || null;
    const roleKey = getString(req.body?.roleKey) || 'admin';
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const serviceAccount =
      await components.automationService.createServiceAccount({
        workspaceId: validatedSession.workspace.id,
        name,
        description,
        roleKey,
        createdBy: validatedSession.user.id,
      });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'service_account.create',
      resource: {
        resourceType: 'service_account',
        resourceId: serviceAccount.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      afterJson: sanitizeServiceAccount(serviceAccount),
    });

    return res.status(201).json({
      serviceAccount: sanitizeServiceAccount(serviceAccount),
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to manage service accounts';
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
