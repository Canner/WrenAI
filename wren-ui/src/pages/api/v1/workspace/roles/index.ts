import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  listWorkspaceRoleBindings,
  listWorkspaceRoleCatalog,
  createCustomWorkspaceRole,
  recordAuditEvent,
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
        action: 'role.read',
        resource: workspaceResource,
        context: auditContext,
      });

      const [catalog, bindings] = await Promise.all([
        listWorkspaceRoleCatalog({
          workspaceId: validatedSession.workspace.id,
          roleRepository: components.roleRepository,
          permissionRepository: components.permissionRepository,
          rolePermissionRepository: components.rolePermissionRepository,
          principalRoleBindingRepository:
            components.principalRoleBindingRepository,
        }),
        listWorkspaceRoleBindings({
          workspaceId: validatedSession.workspace.id,
          roleRepository: components.roleRepository,
          principalRoleBindingRepository:
            components.principalRoleBindingRepository,
          userRepository: components.userRepository,
          workspaceMemberRepository: components.workspaceMemberRepository,
          directoryGroupRepository: components.directoryGroupRepository,
          serviceAccountRepository: components.serviceAccountRepository,
        }),
      ]);

      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'role.read',
        resource: {
          resourceType: 'role_catalog',
          resourceId: validatedSession.workspace.id,
          workspaceId: validatedSession.workspace.id,
        },
        result: 'allowed',
        context: auditContext,
      });

      return res.status(200).json({
        roles: catalog.roles,
        bindings,
        permissionCatalog: catalog.permissionCatalog,
        actionCatalog: catalog.actionCatalog,
      });
    }

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'role.manage',
      resource: workspaceResource,
      context: auditContext,
    });

    const displayName =
      getString(req.body?.displayName) || getString(req.body?.name);
    if (!displayName) {
      return res.status(400).json({ error: 'displayName or name is required' });
    }

    const role = await createCustomWorkspaceRole({
      workspaceId: validatedSession.workspace.id,
      name: getString(req.body?.name) || undefined,
      displayName,
      description: getString(req.body?.description) || null,
      isActive:
        hasOwn(req.body, 'isActive') || hasOwn(req.body, 'is_active')
          ? Boolean(req.body?.isActive ?? req.body?.is_active)
          : undefined,
      permissionNames: Array.isArray(req.body?.permissionNames)
        ? req.body.permissionNames
            .map((value: unknown) => String(value || '').trim())
            .filter(Boolean)
        : [],
      createdBy: validatedSession.user.id,
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
        resourceId: role.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      afterJson: role as any,
    });

    return res.status(201).json({ role });
  } catch (error: any) {
    const message = error?.message || 'Failed to manage workspace roles';
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
