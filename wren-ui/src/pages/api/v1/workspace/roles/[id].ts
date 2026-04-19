import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  deleteCustomWorkspaceRole,
  recordAuditEvent,
  updateCustomWorkspaceRole,
} from '@server/authz';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const hasOwn = (value: unknown, key: string) =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

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
    const roleId = getQueryString(req.query.id);
    if (!roleId) {
      return res.status(400).json({ error: 'role id is required' });
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
      attributes: {
        workspaceKind: validatedSession.workspace.kind || null,
      },
    };

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'role.manage',
      resource: workspaceResource,
      context: auditContext,
    });

    if (req.method === 'DELETE') {
      const deleted = await deleteCustomWorkspaceRole({
        workspaceId: validatedSession.workspace.id,
        roleId,
        roleRepository: components.roleRepository,
      });

      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'role.manage',
        resource: {
          resourceType: 'role',
          resourceId: roleId,
          workspaceId: validatedSession.workspace.id,
        },
        result: 'succeeded',
        context: auditContext,
        beforeJson: deleted as any,
      });

      return res.status(200).json({ ok: true });
    }

    const updated = await updateCustomWorkspaceRole({
      workspaceId: validatedSession.workspace.id,
      roleId,
      name:
        req.body && Object.prototype.hasOwnProperty.call(req.body, 'name')
          ? getString(req.body?.name)
          : undefined,
      displayName:
        req.body &&
        Object.prototype.hasOwnProperty.call(req.body, 'displayName')
          ? getString(req.body?.displayName)
          : undefined,
      description:
        req.body &&
        Object.prototype.hasOwnProperty.call(req.body, 'description')
          ? getString(req.body?.description) || null
          : undefined,
      isActive:
        hasOwn(req.body, 'isActive') || hasOwn(req.body, 'is_active')
          ? Boolean(req.body?.isActive ?? req.body?.is_active)
          : undefined,
      permissionNames: Array.isArray(req.body?.permissionNames)
        ? req.body.permissionNames
            .map((value: unknown) => String(value || '').trim())
            .filter(Boolean)
        : undefined,
      roleRepository: components.roleRepository,
      permissionRepository: components.permissionRepository,
      rolePermissionRepository: components.rolePermissionRepository,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'role.manage',
      resource: {
        resourceType: 'role',
        resourceId: roleId,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      afterJson: updated as any,
    });

    return res.status(200).json({ role: updated });
  } catch (error: any) {
    const message = error?.message || 'Failed to update custom role';
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
