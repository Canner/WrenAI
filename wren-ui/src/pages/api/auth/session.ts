import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import { resolveBootstrapKnowledgeBaseSelection } from '@server/utils/runtimeSelectorState';
import { buildAuthResponseUser } from './responseUser';
import { clearSessionCookie } from './sessionCookie';
import { KBSnapshot, KnowledgeBase } from '@server/repositories';
import { getLogger } from '@server/utils';
import {
  AuthorizationAction,
  assertAuthorizedWithAudit,
  authorize,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  serializeAuthorizationActor,
} from '@server/authz';

const logger = getLogger('API_AUTH_SESSION');
const SESSION_REFRESH_RUNTIME_SEED_MODE =
  process.env.NODE_ENV === 'test' ? 'metadata_only' : 'background_all';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const toRuntimeSelector = (
  workspaceId: string,
  knowledgeBase: KnowledgeBase | null,
  snapshot: KBSnapshot | null,
) => ({
  workspaceId,
  knowledgeBaseId: knowledgeBase?.id || null,
  kbSnapshotId: snapshot?.id || null,
  deployHash: snapshot?.deployHash || null,
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

    try {
      await components.workspaceBootstrapService?.ensureDefaultWorkspaceWithSamples?.(
        {
          runtimeSeedMode: SESSION_REFRESH_RUNTIME_SEED_MODE,
        },
      );
    } catch (error: any) {
      logger.warn(
        `Default workspace sample bootstrap skipped during session refresh: ${
          error?.message || error
        }`,
      );
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
    const knowledgeBases = await components.knowledgeBaseRepository.findAllBy({
      workspaceId: validatedSession.workspace.id,
    });
    const { knowledgeBase: currentKnowledgeBase, snapshot: currentKbSnapshot } =
      await resolveBootstrapKnowledgeBaseSelection(
        knowledgeBases,
        components.kbSnapshotRepository,
        components.deployLogRepository,
      );

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
            resourceId: currentKnowledgeBase?.id || 'current',
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: currentKnowledgeBase?.kind || null,
            },
          }),
          'knowledge_base.update': evaluateAction('knowledge_base.update', {
            resourceType: 'knowledge_base',
            resourceId: currentKnowledgeBase?.id || 'current',
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: currentKnowledgeBase?.kind || null,
            },
          }),
          'knowledge_base.archive': evaluateAction('knowledge_base.archive', {
            resourceType: 'knowledge_base',
            resourceId: currentKnowledgeBase?.id || 'current',
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: currentKnowledgeBase?.kind || null,
            },
          }),
          'connector.create': evaluateAction('connector.create', {
            resourceType: 'connector',
            resourceId: 'new',
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: currentKnowledgeBase?.kind || null,
            },
          }),
          'connector.read': evaluateAction('connector.read', {
            resourceType: 'connector',
            resourceId: 'current',
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: currentKnowledgeBase?.kind || null,
            },
          }),
          'connector.update': evaluateAction('connector.update', {
            resourceType: 'connector',
            resourceId: 'current',
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: currentKnowledgeBase?.kind || null,
            },
          }),
          'connector.delete': evaluateAction('connector.delete', {
            resourceType: 'connector',
            resourceId: 'current',
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: currentKnowledgeBase?.kind || null,
            },
          }),
          'connector.rotate_secret': evaluateAction('connector.rotate_secret', {
            resourceType: 'connector',
            resourceId: 'current',
            workspaceId: validatedSession.workspace.id,
            attributes: {
              workspaceKind: validatedSession.workspace.kind || null,
              knowledgeBaseKind: currentKnowledgeBase?.kind || null,
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
      runtimeSelector: toRuntimeSelector(
        validatedSession.workspace.id,
        currentKnowledgeBase,
        currentKbSnapshot,
      ),
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
