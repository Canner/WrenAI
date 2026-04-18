import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';
import { serializeThreadDetailPayload } from '../threadPayloadSerializers';

const logger = getLogger('API_THREAD_BY_ID');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  askingService,
  auditEventRepository,
  modelService,
  sqlPairService,
} = components;

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

const toThreadResponse = (thread: any) => ({
  id: thread.id,
  summary: thread.summary,
  workspaceId: thread.workspaceId ?? null,
  knowledgeBaseId: thread.knowledgeBaseId ?? null,
  kbSnapshotId: thread.kbSnapshotId ?? null,
  deployHash: thread.deployHash ?? null,
});

const resolveSummary = (payload: unknown) => {
  const summary =
    payload && typeof payload === 'object'
      ? (payload as any).summary
      : undefined;
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw new ApiError('Thread summary is required', 400);
  }

  return summary.trim();
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (
      req.method !== 'GET' &&
      req.method !== 'PATCH' &&
      req.method !== 'DELETE'
    ) {
      throw new ApiError('Method not allowed', 405);
    }

    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    await assertKnowledgeBaseReadAccess({
      req,
      runtimeScope,
    });
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const threadId = parseThreadId(req.query.id);

    if (req.method === 'GET') {
      const thread = await askingService.assertThreadScope(
        threadId,
        runtimeIdentity,
      );
      const responses = await askingService.getResponsesWithThreadScoped(
        threadId,
        runtimeIdentity,
      );
      const responsePayload = await serializeThreadDetailPayload({
        thread,
        responses,
        runtimeIdentity,
        services: {
          askingService,
          modelService,
          sqlPairService,
        },
      });

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

    if (req.method === 'PATCH') {
      const summary = resolveSummary(req.body);
      const updatedThread = await askingService.updateThreadScoped(
        threadId,
        runtimeIdentity,
        {
          summary,
        },
      );

      await respondWithSimple({
        res,
        statusCode: 200,
        responsePayload: toThreadResponse(updatedThread),
        runtimeScope,
        apiType: ApiType.UPDATE_THREAD,
        requestPayload: {
          id: threadId,
          summary,
        },
        headers: req.headers as Record<string, string>,
        startTime,
      });
      return;
    }

    await askingService.deleteThreadScoped(threadId, runtimeIdentity);
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: {
        success: true,
      },
      runtimeScope,
      apiType: ApiType.DELETE_THREAD,
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
      apiType:
        req.method === 'GET'
          ? ApiType.GET_THREADS
          : req.method === 'DELETE'
            ? ApiType.DELETE_THREAD
            : ApiType.UPDATE_THREAD,
      requestPayload: {
        id: Array.isArray(req.query.id)
          ? req.query.id[0]
          : req.query.id || null,
        summary:
          req.method === 'PATCH' && req.body && typeof req.body === 'object'
            ? (req.body as any).summary || null
            : null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
