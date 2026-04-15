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

const toGroupView = (group: any) => ({
  id: group.id,
  workspaceId: group.workspaceId,
  displayName: group.displayName,
  source: group.source,
  status: group.status,
  roleKeys: group.roleKeys || [],
  memberIds: (group.members || []).map((member: any) => member.userId),
  memberCount: Array.isArray(group.members) ? group.members.length : 0,
  createdAt: group.createdAt || null,
  updatedAt: group.updatedAt || null,
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
    const id = getQueryString(req.query.id);
    if (!id) {
      return res.status(400).json({ error: 'group id is required' });
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
    const workspaceResource = {
      resourceType: 'workspace',
      resourceId: validatedSession.workspace.id,
      workspaceId: validatedSession.workspace.id,
      attributes: { workspaceKind: validatedSession.workspace.kind || null },
    };

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'group.manage',
      resource: workspaceResource,
      context: auditContext,
    });

    if (req.method === 'DELETE') {
      await components.governanceService.deleteDirectoryGroup(
        validatedSession.workspace.id,
        id,
      );
      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'group.manage',
        resource: {
          resourceType: 'directory_group',
          resourceId: id,
          workspaceId: validatedSession.workspace.id,
        },
        result: 'succeeded',
        context: auditContext,
      });
      return res.status(200).json({ ok: true });
    }

    const group = await components.governanceService.updateDirectoryGroup({
      workspaceId: validatedSession.workspace.id,
      id,
      displayName: getString(req.body?.displayName) || undefined,
      roleKey:
        req.body && Object.prototype.hasOwnProperty.call(req.body, 'roleKey')
          ? getString(req.body?.roleKey) || null
          : undefined,
      memberIds: Array.isArray(req.body?.memberIds)
        ? req.body.memberIds
            .map((value: unknown) => String(value || '').trim())
            .filter(Boolean)
        : undefined,
      status: getString(req.body?.status) || undefined,
    });

    const serialized = toGroupView(group);
    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'group.manage',
      resource: {
        resourceType: 'directory_group',
        resourceId: group.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      afterJson: serialized as any,
    });

    return res.status(200).json({ group: serialized });
  } catch (error: any) {
    const message = error?.message || 'Failed to update directory group';
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
