import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  ApiType,
  type ApiHistory,
} from '@server/repositories/apiHistoryRepository';
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
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_API_HISTORY');
logger.level = 'debug';

const { runtimeScopeResolver, apiHistoryRepository, auditEventRepository } =
  components;

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const parseRequiredPositiveInt = (
  value: string | undefined,
  fieldName: string,
  fallback: number,
) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(`${fieldName} must be a non-negative integer`, 400);
  }

  return parsed;
};

const parseOptionalStatusCode = (value?: string) => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new ApiError('statusCode must be a number', 400);
  }

  return parsed;
};

const parseOptionalApiType = (value?: string) => {
  if (!value) {
    return undefined;
  }

  if (!Object.values(ApiType).includes(value as ApiType)) {
    throw new ApiError('apiType is invalid', 400);
  }

  return value as ApiType;
};

const normalizeDateInput = (value?: string) => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(`Invalid date value: ${value}`, 400);
  }

  return parsed;
};

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
  payloadJson,
}: {
  actor: ReturnType<typeof buildAuthorizationActorFromRuntimeScope>;
  resource: ReturnType<
    typeof getKnowledgeBaseReadAuthorizationTarget
  >['resource'];
  payloadJson?: Record<string, any>;
}) => {
  await recordAuditEvent({
    auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
    result: 'allowed',
    payloadJson,
  });
};

const sanitizeResponsePayload = (payload: any, apiType?: ApiType): any => {
  if (!payload) {
    return payload;
  }

  const sanitized = { ...payload };

  if (apiType === ApiType.RUN_SQL) {
    if (sanitized.records && Array.isArray(sanitized.records)) {
      sanitized.records = [`${sanitized.records.length} records omitted`];
    }
  }

  if (apiType === ApiType.GENERATE_VEGA_CHART) {
    if (
      sanitized.vegaSpec?.data?.values &&
      Array.isArray(sanitized.vegaSpec.data.values)
    ) {
      sanitized.vegaSpec = {
        ...sanitized.vegaSpec,
        data: {
          ...sanitized.vegaSpec.data,
          values: [
            `${sanitized.vegaSpec.data.values.length} data points omitted`,
          ],
        },
      };
    }
  }

  return sanitized;
};

const serializeApiHistoryItem = (item: ApiHistory) => ({
  ...item,
  createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
  updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
  responsePayload: sanitizeResponsePayload(item.responsePayload, item.apiType),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (req.method !== 'GET') {
      throw new ApiError('Method not allowed', 405);
    }

    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    const { actor, resource } = await assertKnowledgeBaseReadAccess({
      req,
      runtimeScope,
    });
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);

    const apiType = parseOptionalApiType(getQueryString(req.query.apiType));
    const statusCode = parseOptionalStatusCode(
      getQueryString(req.query.statusCode),
    );
    const threadId = getQueryString(req.query.threadId) || undefined;
    const startDate = normalizeDateInput(getQueryString(req.query.startDate));
    const endDate = normalizeDateInput(getQueryString(req.query.endDate));
    const offset = parseRequiredPositiveInt(
      getQueryString(req.query.offset),
      'offset',
      0,
    );
    const limit = parseRequiredPositiveInt(
      getQueryString(req.query.limit),
      'limit',
      10,
    );

    const filterCriteria: Partial<ApiHistory> = {
      ...(runtimeIdentity.projectId != null
        ? { projectId: runtimeIdentity.projectId }
        : {}),
      ...(runtimeIdentity.workspaceId
        ? { workspaceId: runtimeIdentity.workspaceId }
        : {}),
      ...(runtimeIdentity.knowledgeBaseId
        ? { knowledgeBaseId: runtimeIdentity.knowledgeBaseId }
        : {}),
      ...(runtimeIdentity.kbSnapshotId
        ? { kbSnapshotId: runtimeIdentity.kbSnapshotId }
        : {}),
      ...(runtimeIdentity.deployHash
        ? { deployHash: runtimeIdentity.deployHash }
        : {}),
      ...(apiType ? { apiType } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(threadId ? { threadId } : {}),
    };

    const dateFilter = {
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    };

    const total = await apiHistoryRepository.count(filterCriteria, dateFilter);
    const items =
      total === 0 || total <= offset
        ? []
        : await apiHistoryRepository.findAllWithPagination(
            filterCriteria,
            dateFilter,
            {
              offset,
              limit,
              orderBy: { createdAt: 'desc' },
            },
          );

    await recordKnowledgeBaseReadAudit({
      actor,
      resource,
      payloadJson: {
        operation: 'get_api_history',
      },
    });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: {
        items: items.map(serializeApiHistoryItem),
        total,
        hasMore: offset + limit < total,
      },
      runtimeScope,
      apiType: ApiType.GET_API_HISTORY,
      requestPayload: {
        apiType: apiType || null,
        statusCode: statusCode ?? null,
        threadId: threadId || null,
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
        offset,
        limit,
      },
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.GET_API_HISTORY,
      requestPayload: {
        apiType: getQueryString(req.query.apiType) || null,
        statusCode: getQueryString(req.query.statusCode) || null,
        threadId: getQueryString(req.query.threadId) || null,
        startDate: getQueryString(req.query.startDate) || null,
        endDate: getQueryString(req.query.endDate) || null,
        offset: getQueryString(req.query.offset) || null,
        limit: getQueryString(req.query.limit) || null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
