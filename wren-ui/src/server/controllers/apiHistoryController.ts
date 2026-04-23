import {
  ApiType,
  ApiHistory,
  AskShadowCompareStats,
} from '@server/repositories/apiHistoryRepository';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { toPersistedRuntimeIdentityPatch } from '@server/utils/persistedRuntimeIdentity';
import { IContext } from '@server/types';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';

const ASK_SHADOW_COMPARE_API_TYPES = [ApiType.ASK, ApiType.STREAM_ASK];

const requireAuthorizationActor = (ctx: IContext) =>
  ctx.authorizationActor ||
  buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope);

const assertKnowledgeBaseReadAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
  });
};

const getKnowledgeBaseReadAuthorizationTarget = (ctx: IContext) => {
  const runtimeIdentity = toPersistedRuntimeIdentity(ctx.runtimeScope!);
  const workspaceId =
    ctx.runtimeScope?.workspace?.id || runtimeIdentity.workspaceId || null;
  const knowledgeBase = ctx.runtimeScope?.knowledgeBase;

  return {
    actor: requireAuthorizationActor(ctx),
    resource: {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || workspaceId,
      workspaceId,
      attributes: {
        workspaceKind: ctx.runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: knowledgeBase?.kind || null,
      },
    },
  };
};

const recordKnowledgeBaseReadAudit = async (
  ctx: IContext,
  payloadJson?: Record<string, any> | null,
) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(ctx);
  await recordAuditEvent({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
    result: 'allowed',
    payloadJson: payloadJson || undefined,
  });
};

export interface ApiHistoryFilter {
  apiType?: ApiType;
  statusCode?: number;
  threadId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ApiHistoryPagination {
  offset: number;
  limit: number;
}

const toDateFilter = (filter?: ApiHistoryFilter) => {
  const dateFilter: { startDate?: Date; endDate?: Date } = {};

  if (filter?.startDate) {
    dateFilter.startDate = new Date(filter.startDate);
  }
  if (filter?.endDate) {
    dateFilter.endDate = new Date(filter.endDate);
  }

  return dateFilter;
};

const toScopedFilterCriteria = (
  filter: ApiHistoryFilter | undefined,
  runtimeIdentity: ReturnType<typeof toPersistedRuntimeIdentity>,
) => {
  const runtimeProjectBridgeId = runtimeIdentity.projectId ?? null;
  const filterCriteria: Partial<ApiHistory> = {
    projectId: runtimeProjectBridgeId,
    workspaceId: runtimeIdentity.workspaceId ?? null,
    knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
    kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
    deployHash: runtimeIdentity.deployHash ?? null,
  };

  if (!filter) {
    return filterCriteria;
  }

  if (filter.statusCode) {
    filterCriteria.statusCode = filter.statusCode;
  }

  if (filter.threadId) {
    filterCriteria.threadId = filter.threadId;
  }

  return filterCriteria;
};

/**
 * Sanitize response payload to remove large data fields
 * This prevents excessive data transfer when displaying API history
 * @param payload The response payload to sanitize
 * @param apiType The type of API that generated this response
 */
const sanitizeResponsePayload = (payload: any, apiType?: ApiType): any => {
  if (!payload) return payload;

  const sanitized = { ...payload };

  // Handle specifically RUN_SQL responses that contain large record sets
  if (apiType === ApiType.RUN_SQL) {
    // Remove records array but keep metadata about how many records were returned
    if (sanitized.records && Array.isArray(sanitized.records)) {
      const recordCount = sanitized.records.length;
      sanitized.records = [`${recordCount} records omitted`];
    }
  }

  // Handle specifically GENERATE_VEGA_CHART responses that contain large data values
  if (apiType === ApiType.GENERATE_VEGA_CHART) {
    // Remove vegaSpec.data.values array but keep the structure
    if (
      sanitized.vegaSpec?.data?.values &&
      Array.isArray(sanitized.vegaSpec.data.values)
    ) {
      const dataCount = sanitized.vegaSpec.data.values.length;
      sanitized.vegaSpec.data.values = [`${dataCount} data points omitted`];
    }
  }

  return sanitized;
};

export class ApiHistoryController {
  constructor() {
    this.getApiHistory = this.getApiHistory.bind(this);
    this.getAskShadowCompareStats = this.getAskShadowCompareStats.bind(this);
  }

  /**
   * Get API history with filtering and pagination
   */
  public async getApiHistory(
    _root: unknown,
    args: {
      filter?: ApiHistoryFilter;
      pagination: ApiHistoryPagination;
    },
    ctx: IContext,
  ) {
    await assertKnowledgeBaseReadAccess(ctx);
    const { filter, pagination } = args;
    const { offset, limit } = pagination;
    const runtimeIdentity = toPersistedRuntimeIdentityPatch(
      toPersistedRuntimeIdentity(ctx.runtimeScope!),
    );
    const filterCriteria = toScopedFilterCriteria(filter, runtimeIdentity);
    const dateFilter = toDateFilter(filter);

    if (filter?.apiType) {
      filterCriteria.apiType = filter.apiType;
    }

    // Get total count for pagination info
    const total = await ctx.apiHistoryRepository.count(
      filterCriteria,
      dateFilter,
    );

    if (total === 0 || total <= offset) {
      return {
        items: [],
        total,
        hasMore: false,
      };
    }

    // Get paginated items
    const items = await ctx.apiHistoryRepository.findAllWithPagination(
      filterCriteria,
      dateFilter,
      {
        offset,
        limit,
        orderBy: { createdAt: 'desc' },
      },
    );

    await recordKnowledgeBaseReadAudit(ctx, {
      operation: 'get_api_history',
    });

    return {
      items,
      total,
      hasMore: offset + limit < total,
    };
  }

  public async getAskShadowCompareStats(
    _root: unknown,
    args: {
      filter?: ApiHistoryFilter;
    },
    ctx: IContext,
  ): Promise<AskShadowCompareStats> {
    await assertKnowledgeBaseReadAccess(ctx);
    const filter = args?.filter;
    const runtimeIdentity = toPersistedRuntimeIdentityPatch(
      toPersistedRuntimeIdentity(ctx.runtimeScope!),
    );
    const filterCriteria = toScopedFilterCriteria(filter, runtimeIdentity);
    const dateFilter = toDateFilter(filter);
    const apiTypes = this.getAskShadowCompareApiTypes(filter?.apiType);

    const result = await ctx.apiHistoryRepository.getAskShadowCompareStats(
      filterCriteria,
      dateFilter,
      apiTypes,
    );
    await recordKnowledgeBaseReadAudit(ctx, {
      operation: 'get_ask_shadow_compare_stats',
    });
    return result;
  }

  private getAskShadowCompareApiTypes(apiType?: ApiType): ApiType[] {
    if (!apiType) {
      return ASK_SHADOW_COMPARE_API_TYPES;
    }

    if (!ASK_SHADOW_COMPARE_API_TYPES.includes(apiType)) {
      throw new Error(
        'askShadowCompareStats only supports ASK or STREAM_ASK apiType filters',
      );
    }

    return [apiType];
  }

  /**
   * Field mappers for ApiHistoryResponse fields
   */
  public getApiHistoryNestedResolver = () => ({
    createdAt: (apiHistory: ApiHistory) => {
      return apiHistory.createdAt
        ? new Date(apiHistory.createdAt).toISOString()
        : null;
    },
    updatedAt: (apiHistory: ApiHistory) => {
      return apiHistory.updatedAt
        ? new Date(apiHistory.updatedAt).toISOString()
        : null;
    },
    responsePayload: (apiHistory: ApiHistory) => {
      if (!apiHistory.responsePayload) return null;

      // If the response payload is an array, return it as is
      if (Array.isArray(apiHistory.responsePayload))
        return apiHistory.responsePayload;

      // Otherwise, sanitize the response payload
      return sanitizeResponsePayload(
        apiHistory.responsePayload,
        apiHistory.apiType,
      );
    },
  });
}
