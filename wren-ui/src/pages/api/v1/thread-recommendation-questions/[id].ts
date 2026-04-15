import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';

const logger = getLogger('API_THREAD_RECOMMENDATION_QUESTIONS_BY_ID');
logger.level = 'debug';

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
};

const parseThreadId = (id: string | string[] | undefined) => {
  const value = Array.isArray(id) ? id[0] : id;
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError('Thread ID is invalid', 400);
  }

  return parsed;
};

const buildRuntimeIdentity = (runtimeScope: any) => ({
  projectId: runtimeScope?.project?.id ?? null,
  workspaceId: runtimeScope?.workspace?.id ?? null,
  knowledgeBaseId: runtimeScope?.knowledgeBase?.id ?? null,
  kbSnapshotId: runtimeScope?.kbSnapshot?.id ?? null,
  deployHash: runtimeScope?.deployHash ?? null,
  actorUserId: runtimeScope?.userId ?? null,
});

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
    await assertKnowledgeBaseReadAccess({
      req,
      runtimeScope,
    });
    const threadId = parseThreadId(req.query.id);
    const runtimeIdentity = buildRuntimeIdentity(runtimeScope);
    await askingService.assertThreadScope(threadId, runtimeIdentity);

    if (req.method === 'GET') {
      const responsePayload =
        await askingService.getThreadRecommendationQuestions(threadId);

      await respondWithSimple({
        res,
        statusCode: 200,
        responsePayload,
        runtimeScope,
        apiType: ApiType.GET_THREADS,
        requestPayload: {
          id: threadId,
        },
        headers: req.headers as Record<string, string>,
        startTime,
      });
      return;
    }

    await askingService.generateThreadRecommendationQuestions(
      threadId,
      runtimeScope?.selector?.runtimeScopeId || null,
    );

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: { success: true },
      runtimeScope,
      apiType: ApiType.ASK,
      requestPayload: {
        id: threadId,
      },
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: req.method === 'GET' ? ApiType.GET_THREADS : ApiType.ASK,
      requestPayload: {
        id: Array.isArray(req.query.id)
          ? req.query.id[0]
          : req.query.id || null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
