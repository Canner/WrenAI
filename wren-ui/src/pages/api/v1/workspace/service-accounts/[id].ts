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

    const serviceAccounts =
      await components.automationService.listServiceAccounts(
        validatedSession.workspace.id,
      );
    const serviceAccount = serviceAccounts.find(
      (item) => item.id === serviceAccountId,
    );
    if (!serviceAccount) {
      return res.status(404).json({ error: 'Service account not found' });
    }

    const resource = {
      resourceType: 'service_account',
      resourceId: serviceAccount.id,
      workspaceId: validatedSession.workspace.id,
      attributes: {
        workspaceKind: validatedSession.workspace.kind || null,
      },
    };

    if (req.method === 'DELETE') {
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'service_account.delete',
        resource,
        context: auditContext,
      });

      await components.automationService.deleteServiceAccount(
        validatedSession.workspace.id,
        serviceAccount.id,
      );

      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'service_account.delete',
        resource,
        result: 'succeeded',
        context: auditContext,
        beforeJson: sanitizeServiceAccount(serviceAccount),
      });

      return res.status(200).json({ ok: true });
    }

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'service_account.update',
      resource,
      context: auditContext,
    });

    const updated = await components.automationService.updateServiceAccount({
      workspaceId: validatedSession.workspace.id,
      serviceAccountId: serviceAccount.id,
      name: getString(req.body?.name) || undefined,
      description:
        req.body?.description === undefined
          ? undefined
          : getString(req.body?.description) || null,
      roleKey: getString(req.body?.roleKey) || undefined,
      status: getString(req.body?.status) || undefined,
      updatedBy: validatedSession.user.id,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'service_account.update',
      resource,
      result: 'succeeded',
      context: auditContext,
      beforeJson: sanitizeServiceAccount(serviceAccount),
      afterJson: sanitizeServiceAccount(updated),
    });

    return res.status(200).json({
      serviceAccount: sanitizeServiceAccount(updated),
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to update service account';
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
