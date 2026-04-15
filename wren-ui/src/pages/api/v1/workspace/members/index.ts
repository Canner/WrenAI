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

    const email = getString(req.body?.email).toLowerCase();
    const roleKey = getString(req.body?.roleKey) || 'member';
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.member.invite',
      resource: {
        resourceType: 'workspace',
        resourceId: validatedSession.workspace.id,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
          nextRoleKey: roleKey,
        },
      },
      context: auditContext,
    });

    const membership = await components.workspaceService.inviteMemberByEmail({
      workspaceId: validatedSession.workspace.id,
      email,
      roleKey,
      status: 'invited',
      actor,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.member.invite',
      resource: {
        resourceType: 'workspace_member',
        resourceId: membership.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      afterJson: membership as any,
      payloadJson: {
        email,
        roleKey,
      },
    });

    return res.status(200).json({ membership });
  } catch (error: any) {
    const message = error?.message || 'Failed to invite workspace member';
    const statusCode =
      error?.statusCode || (/not found/i.test(message) ? 404 : 400);
    return res.status(statusCode).json({ error: message });
  }
}
