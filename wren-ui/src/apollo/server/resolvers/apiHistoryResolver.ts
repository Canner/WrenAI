import {
  ApiType,
  ApiHistory,
  AskShadowCompareStats,
} from '@server/repositories/apiHistoryRepository';
import { IContext } from '@server/types';

const ASK_SHADOW_COMPARE_API_TYPES = [ApiType.ASK, ApiType.STREAM_ASK];

export interface ApiHistoryFilter {
  apiType?: ApiType;
  statusCode?: number;
  threadId?: string;
  projectId?: number;
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
  activeProjectId: number,
) => {
  const filterCriteria: Partial<ApiHistory> = {
    projectId: activeProjectId,
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

  if (filter.projectId && filter.projectId !== activeProjectId) {
    throw new Error(
      'apiHistory projectId filter does not match active runtime scope',
    );
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

export class ApiHistoryResolver {
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
    const { filter, pagination } = args;
    const { offset, limit } = pagination;
    const activeProjectId = ctx.runtimeScope!.project.id;
    const filterCriteria = toScopedFilterCriteria(filter, activeProjectId);
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
    const filter = args?.filter;
    const activeProjectId = ctx.runtimeScope!.project.id;
    const filterCriteria = toScopedFilterCriteria(filter, activeProjectId);
    const dateFilter = toDateFilter(filter);
    const apiTypes = this.getAskShadowCompareApiTypes(filter?.apiType);

    return await ctx.apiHistoryRepository.getAskShadowCompareStats(
      filterCriteria,
      dateFilter,
      apiTypes,
    );
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
   * Resolver for ApiHistoryResponse fields
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
