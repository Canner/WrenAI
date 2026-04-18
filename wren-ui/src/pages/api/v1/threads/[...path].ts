import type { NextApiRequest, NextApiResponse } from 'next';
import type { AskingDetailTaskInput } from '@server/services/askingService';
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
import { serializeThreadResponsePayload } from '../threadPayloadSerializers';

const logger = getLogger('API_THREAD_RESPONSE_COLLECTION');
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

const parseThreadResponseCollectionPath = (
  value: string | string[] | undefined,
): number => {
  if (!Array.isArray(value) || value.length !== 2 || value[1] !== 'responses') {
    throw new ApiError('Route not found', 404);
  }

  const threadId = Number.parseInt(String(value[0] || ''), 10);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    throw new ApiError('Thread ID is invalid', 400);
  }

  return threadId;
};

type CreateThreadResponsePayload = {
  question?: string;
  sql?: string;
  taskId?: string;
};

const resolveCreateThreadResponsePayload = (
  payload: unknown,
): CreateThreadResponsePayload => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const source = payload as Record<string, unknown>;
  return {
    question: typeof source.question === 'string' ? source.question : undefined,
    sql: typeof source.sql === 'string' ? source.sql : undefined,
    taskId: typeof source.taskId === 'string' ? source.taskId : undefined,
  };
};

const buildCreateThreadResponseInput = async ({
  payload,
  runtimeIdentity,
}: {
  payload: CreateThreadResponsePayload;
  runtimeIdentity: ReturnType<
    typeof toCanonicalPersistedRuntimeIdentityFromScope
  >;
}): Promise<AskingDetailTaskInput> => {
  if (payload.taskId) {
    await askingService.assertAskingTaskScope(payload.taskId, runtimeIdentity);
    const askingTask = await askingService.getAskingTask(payload.taskId);
    if (!askingTask) {
      throw new Error(`Asking task ${payload.taskId} not found`);
    }

    return {
      question: askingTask.question,
      trackedAskingResult: askingTask,
    };
  }

  return {
    question: payload.question,
    sql: payload.sql,
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    await assertKnowledgeBaseReadAccess({
      req,
      runtimeScope,
    });
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const threadId = parseThreadResponseCollectionPath(req.query.path);
    const payload = resolveCreateThreadResponsePayload(req.body);
    const input = await buildCreateThreadResponseInput({
      payload,
      runtimeIdentity,
    });
    const response = await askingService.createThreadResponseScoped(
      input,
      threadId,
      runtimeIdentity,
    );
    const responsePayload = await serializeThreadResponsePayload({
      response,
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
      apiType: ApiType.ASK,
      requestPayload: {
        id: threadId,
        data: payload,
      },
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.ASK,
      requestPayload: {
        path: req.query.path || null,
        data: req.body && typeof req.body === 'object' ? req.body : null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
