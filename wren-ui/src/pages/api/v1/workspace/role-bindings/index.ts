import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  createWorkspaceRoleBinding,
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
      action: 'role.manage',
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
    const roleId = getString(req.body?.roleId);
    if (!principalType || !principalId || !roleId) {
      return res.status(400).json({
        error: 'principalType, principalId and roleId are required',
      });
    }

    const binding = await createWorkspaceRoleBinding({
      workspaceId: validatedSession.workspace.id,
      principalType,
      principalId,
      roleId,
      createdBy: validatedSession.user.id,
      roleRepository: components.roleRepository,
      principalRoleBindingRepository: components.principalRoleBindingRepository,
      workspaceMemberRepository: components.workspaceMemberRepository,
      directoryGroupRepository: components.directoryGroupRepository,
      serviceAccountRepository: components.serviceAccountRepository,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'role.manage',
      resource: {
        resourceType: 'role_binding',
        resourceId: binding.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      afterJson: binding as any,
    });

    return res.status(201).json({ binding });
  } catch (error: any) {
    const message = error?.message || 'Failed to create role binding';
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
