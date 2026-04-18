import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  explainWorkspaceAuthorization,
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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
      action: 'role.read',
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

    const principalType = getString(req.body?.principalType) as
      | 'user'
      | 'group'
      | 'service_account';
    const principalId = getString(req.body?.principalId);
    if (!principalType || !principalId) {
      return res
        .status(400)
        .json({ error: 'principalType and principalId are required' });
    }

    const explanation = await explainWorkspaceAuthorization({
      workspaceId: validatedSession.workspace.id,
      principalType,
      principalId,
      action: getString(req.body?.action) || undefined,
      resource: {
        resourceType: getString(req.body?.resourceType) || 'workspace',
        resourceId:
          getString(req.body?.resourceId) || validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes:
          req.body?.resourceAttributes &&
          typeof req.body.resourceAttributes === 'object'
            ? req.body.resourceAttributes
            : undefined,
      },
      roleRepository: components.roleRepository,
      principalRoleBindingRepository: components.principalRoleBindingRepository,
      directoryGroupRepository: components.directoryGroupRepository,
      directoryGroupMemberRepository: components.directoryGroupMemberRepository,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'role.read',
      resource: {
        resourceType: 'authorization_explain',
        resourceId: `${principalType}:${principalId}`,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'allowed',
      context: auditContext,
      payloadJson: {
        action: getString(req.body?.action) || null,
        resourceType: getString(req.body?.resourceType) || 'workspace',
        resourceId:
          getString(req.body?.resourceId) || validatedSession.workspace.id,
      },
    });

    return res.status(200).json(explanation);
  } catch (error: any) {
    const message = error?.message || 'Failed to explain authorization';
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
