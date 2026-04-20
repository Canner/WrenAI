import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import { buildAuthResponseUser } from './responseUser';
import { clearSessionCookie } from './sessionCookie';
import {
  AuthorizationAction,
  assertAuthorizedWithAudit,
  authorize,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  serializeAuthorizationActor,
} from '@server/authz';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const toRuntimeSelector = (workspaceId: string) => ({
  workspaceId,
  knowledgeBaseId: null,
  kbSnapshotId: null,
  deployHash: null,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(200).json({ authenticated: false });
    }

    const workspaceId = getQueryString(req.query.workspaceId);
    const validatedSession = await components.authService.validateSession(
      sessionToken,
      workspaceId,
    );

    if (!validatedSession) {
      res.setHeader('Set-Cookie', clearSessionCookie(req));
      return res.status(200).json({ authenticated: false });
    }

    const authorizationActor =
      buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: authorizationActor.sessionId,
    });
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor: authorizationActor,
      action: 'workspace.read',
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
    const workspaces = await components.workspaceService.listWorkspacesForUser(
      validatedSession.user.id,
    );
    const evaluateAction = (
      action: AuthorizationAction,
      resource: Parameters<typeof authorize>[0]['resource'],
    ) =>
      authorize({
        actor: authorizationActor,
        action,
        resource,
      }).allowed;
    const currentKnowledgeBaseId = 'current';
    const currentConnectorResourceId = 'current';

    return res.status(200).json({
      authenticated: true,
      user: buildAuthResponseUser({
        user: validatedSession.user,
        isPlatformAdmin: authorizationActor.isPlatformAdmin,
      }),
      workspace: validatedSession.workspace,
      membership: validatedSession.membership,
      actorClaims: validatedSession.actorClaims,
      authorization: {
        actor: serializeAuthorizationActor(authorizationActor),
        actions: {
          'workspace.create': evaluateAction('workspace.create', {
            resourceType: 'workspace',
            resourceId: 'new',
            workspaceId:
              authorizationActor.workspaceId || validatedSession.workspace.id,
          }),
          'workspace.default.set': evaluateAction('workspace.default.set', {
            resourceType: 'workspace',
            resourceId: validatedSession.user.defaultWorkspaceId || 'self',
            ownerUserId: validatedSession.user.id,
          }),
          'workspace.member.invite': evaluateAction('workspace.member.invite', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'workspace.schedule.manage': evaluateAction(
            'workspace.schedule.manage',
            {
              resourceType: 'workspace',
              resourceId: validatedSession.workspace.id,
              workspaceId: validatedSession.workspace.id,
            },
          ),
          'knowledge_base.create': evaluateAction('knowledge_base.create', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'knowledge_base.read': evaluateAction('knowledge_base.read', {
            resourceType: 'knowledge_base',
            resourceId: currentKnowledgeBaseId,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: null,
            },
          }),
          'knowledge_base.update': evaluateAction('knowledge_base.update', {
            resourceType: 'knowledge_base',
            resourceId: currentKnowledgeBaseId,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: null,
            },
          }),
          'knowledge_base.archive': evaluateAction('knowledge_base.archive', {
            resourceType: 'knowledge_base',
            resourceId: currentKnowledgeBaseId,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: null,
            },
          }),
          'connector.create': evaluateAction('connector.create', {
            resourceType: 'connector',
            resourceId: 'new',
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: null,
            },
          }),
          'connector.read': evaluateAction('connector.read', {
            resourceType: 'connector',
            resourceId: currentConnectorResourceId,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: null,
            },
          }),
          'connector.update': evaluateAction('connector.update', {
            resourceType: 'connector',
            resourceId: currentConnectorResourceId,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: null,
            },
          }),
          'connector.delete': evaluateAction('connector.delete', {
            resourceType: 'connector',
            resourceId: currentConnectorResourceId,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: null,
            },
          }),
          'connector.rotate_secret': evaluateAction('connector.rotate_secret', {
            resourceType: 'connector',
            resourceId: currentConnectorResourceId,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: null,
            },
          }),
          'skill.create': evaluateAction('skill.create', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
          }),
          'skill.read': evaluateAction('skill.read', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
          }),
          'skill.update': evaluateAction('skill.update', {
            resourceType: 'skill_definition',
            resourceId: 'current',
            workspaceId: validatedSession.workspace.id,
          }),
          'skill.delete': evaluateAction('skill.delete', {
            resourceType: 'skill_definition',
            resourceId: 'current',
            workspaceId: validatedSession.workspace.id,
          }),
          'secret.reencrypt': evaluateAction('secret.reencrypt', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
          }),
          'service_account.read': evaluateAction('service_account.read', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'service_account.create': evaluateAction('service_account.create', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'service_account.update': evaluateAction('service_account.update', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'service_account.delete': evaluateAction('service_account.delete', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'api_token.read': evaluateAction('api_token.read', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'api_token.create': evaluateAction('api_token.create', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'api_token.revoke': evaluateAction('api_token.revoke', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'identity_provider.read': evaluateAction('identity_provider.read', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'identity_provider.manage': evaluateAction(
            'identity_provider.manage',
            {
              resourceType: 'workspace',
              resourceId: validatedSession.workspace.id,
              workspaceId: validatedSession.workspace.id,
              attributes: {
                workspaceKind: validatedSession.workspace.kind || null,
              },
            },
          ),
          'access_review.read': evaluateAction('access_review.read', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'access_review.manage': evaluateAction('access_review.manage', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
            },
          }),
          'impersonation.start': evaluateAction('impersonation.start', {
            resourceType: 'workspace',
            resourceId: validatedSession.workspace.id,
            workspaceId: validatedSession.workspace.id,
          }),
        },
      },
      workspaces,
      isPlatformAdmin: authorizationActor.isPlatformAdmin,
      defaultWorkspaceId: validatedSession.user.defaultWorkspaceId ?? null,
      runtimeSelector: toRuntimeSelector(validatedSession.workspace.id),
      session: {
        id: validatedSession.session.id,
        expiresAt: validatedSession.session.expiresAt,
        lastSeenAt: validatedSession.session.lastSeenAt || null,
        impersonatorUserId: validatedSession.session.impersonatorUserId || null,
        impersonationReason:
          validatedSession.session.impersonationReason || null,
      },
      impersonation: {
        active: Boolean(validatedSession.session.impersonatorUserId),
        canStop: Boolean(validatedSession.session.impersonatorUserId),
        impersonatorUserId: validatedSession.session.impersonatorUserId || null,
        reason: validatedSession.session.impersonationReason || null,
      },
    });
  } catch (error: any) {
    return res
      .status(error?.statusCode || 400)
      .json({ error: error?.message || 'Session failed' });
  }
}
