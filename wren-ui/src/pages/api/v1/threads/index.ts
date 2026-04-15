import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { AskingResolver } from '@server/resolvers/askingResolver';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import { buildResolverContextFromRequest } from '../resolverContext';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_THREADS');
logger.level = 'debug';
const askingResolver = new AskingResolver();

const { runtimeScopeResolver, askingService, auditEventRepository } =
  components;

const getKnowledgeBaseReadAuthorizationTarget = (runtimeScope: any) => ({
  actor: buildAuthorizationActorFromRuntimeScope(runtimeScope),
  resource: {
    resourceType: runtimeScope?.knowledgeBase ? 'knowledge_base' : 'workspace',
    resourceId: runtimeScope?.knowledgeBase?.id || runtimeScope?.workspace?.id,
    workspaceId: runtimeScope?.workspace?.id || null,
    attributes: {
      workspaceKind: runtimeScope?.workspace?.kind || null,
      knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
    },
  },
});

const assertKnowledgeBaseReadAccess = async ({
  req,
  runtimeScope,
}: {
  req: NextApiRequest;
  runtimeScope: any;
}) => {
  const { actor, resource } =
    getKnowledgeBaseReadAuthorizationTarget(runtimeScope);

  await assertAuthorizedWithAudit({
    auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });

  return { actor, resource };
};

const recordKnowledgeBaseReadAudit = async ({
  actor,
  resource,
}: {
  actor: ReturnType<typeof buildAuthorizationActorFromRuntimeScope>;
  resource: ReturnType<
    typeof getKnowledgeBaseReadAuthorizationTarget
  >['resource'];
}) => {
  await recordAuditEvent({
    auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
    result: 'allowed',
    payloadJson: {
      operation: 'list_threads',
    },
  });
};

const toThreadSummaryResponse = (
  threads: Awaited<ReturnType<typeof askingService.listThreads>>,
) =>
  threads.map((thread) => ({
    id: thread.id,
    summary: thread.summary,
    workspaceId: thread.workspaceId ?? null,
    knowledgeBaseId: thread.knowledgeBaseId ?? null,
    kbSnapshotId: thread.kbSnapshotId ?? null,
    deployHash: thread.deployHash ?? null,
  }));

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);

    if (req.method === 'POST') {
      const ctx = await buildResolverContextFromRequest({ req, runtimeScope });
      const thread = await askingResolver.createThread(
        null,
        {
          data: {
            question:
              typeof req.body?.question === 'string'
                ? req.body.question
                : undefined,
            taskId:
              typeof req.body?.taskId === 'string'
                ? req.body.taskId
                : undefined,
            sql: typeof req.body?.sql === 'string' ? req.body.sql : undefined,
            knowledgeBaseIds: Array.isArray(req.body?.knowledgeBaseIds)
              ? req.body.knowledgeBaseIds
              : undefined,
            selectedSkillIds: Array.isArray(req.body?.selectedSkillIds)
              ? req.body.selectedSkillIds
              : undefined,
          },
        },
        ctx,
      );

      await respondWithSimple({
        res,
        statusCode: 201,
        responsePayload: thread,
        runtimeScope,
        apiType: ApiType.ASK,
        requestPayload:
          req.body && typeof req.body === 'object' ? req.body : {},
        headers: req.headers as Record<string, string>,
        startTime,
      });
      return;
    }

    const { actor, resource } = await assertKnowledgeBaseReadAccess({
      req,
      runtimeScope,
    });
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const threads = await askingService.listThreads(runtimeIdentity);

    await recordKnowledgeBaseReadAudit({ actor, resource });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: toThreadSummaryResponse(threads),
      runtimeScope,
      apiType: ApiType.GET_THREADS,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: req.method === 'POST' ? ApiType.ASK : ApiType.GET_THREADS,
      requestPayload:
        req.method === 'POST' && req.body && typeof req.body === 'object'
          ? req.body
          : {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
