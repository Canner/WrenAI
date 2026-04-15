import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';
import { serializeThreadResponsePayload } from '../threadPayloadSerializers';

const logger = getLogger('API_THREAD_RESPONSE_BY_ID');
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

const parseResponseId = (id: string | string[] | undefined) => {
  const value = Array.isArray(id) ? id[0] : id;
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError('Response ID is invalid', 400);
  }

  return parsed;
};

const resolveSqlPayload = (payload: unknown) => {
  const sql =
    payload && typeof payload === 'object' ? (payload as any).sql : undefined;
  if (typeof sql !== 'string') {
    throw new ApiError('Thread response SQL is required', 400);
  }

  return sql;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (req.method !== 'GET' && req.method !== 'PATCH') {
      throw new ApiError('Method not allowed', 405);
    }

    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    await assertKnowledgeBaseReadAccess({
      req,
      runtimeScope,
    });
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const responseId = parseResponseId(req.query.id);

    if (req.method === 'GET') {
      const response = await askingService.getResponseScoped(
        responseId,
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
        apiType: ApiType.GET_THREADS,
        requestPayload: {
          id: responseId,
        },
        headers: req.headers as Record<string, string>,
        startTime,
      });
      return;
    }

    const sql = resolveSqlPayload(req.body);
    const response = await askingService.updateThreadResponseScoped(
      responseId,
      runtimeIdentity,
      { sql },
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
      apiType: ApiType.UPDATE_THREAD,
      requestPayload: {
        id: responseId,
        sql,
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
        req.method === 'GET' ? ApiType.GET_THREADS : ApiType.UPDATE_THREAD,
      requestPayload: {
        id: Array.isArray(req.query.id)
          ? req.query.id[0]
          : req.query.id || null,
        sql:
          req.method === 'PATCH' && req.body && typeof req.body === 'object'
            ? (req.body as any).sql || null
            : null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
