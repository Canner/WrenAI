import { useMemo } from 'react';
import { ApiType } from '@/types/apiHistory';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import useRestRequest from './useRestRequest';

export type ApiHistoryListItem = {
  id: string;
  apiType: ApiType | string;
  threadId?: string | null;
  headers?: Record<string, string> | null;
  requestPayload?: Record<string, any> | null;
  responsePayload?: Record<string, any> | null;
  statusCode?: number | null;
  durationMs?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ApiHistoryListResponse = {
  items: ApiHistoryListItem[];
  total: number;
  hasMore: boolean;
};

export type ApiHistoryListFilter = {
  apiType?: ApiType;
  statusCode?: number;
  threadId?: string;
  startDate?: string;
  endDate?: string;
};

const DEFAULT_RESPONSE: ApiHistoryListResponse = {
  items: [],
  total: 0,
  hasMore: false,
};

export const normalizeApiHistoryListPayload = (
  payload: unknown,
): ApiHistoryListResponse => {
  if (!payload || typeof payload !== 'object') {
    return DEFAULT_RESPONSE;
  }

  const normalized = payload as Partial<ApiHistoryListResponse>;

  return {
    items: Array.isArray(normalized.items)
      ? (normalized.items as ApiHistoryListItem[])
      : DEFAULT_RESPONSE.items,
    total:
      typeof normalized.total === 'number'
        ? normalized.total
        : DEFAULT_RESPONSE.total,
    hasMore:
      typeof normalized.hasMore === 'boolean'
        ? normalized.hasMore
        : DEFAULT_RESPONSE.hasMore,
  };
};

export const buildApiHistoryListRequestKey = ({
  enabled,
  pagination,
  filter,
  runtimeScopeSelector,
}: {
  enabled: boolean;
  pagination: {
    offset: number;
    limit: number;
  };
  filter?: ApiHistoryListFilter;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
}) =>
  enabled
    ? buildApiHistoryListUrl({
        pagination,
        filter,
        runtimeScopeSelector,
      })
    : null;

export const buildApiHistoryListUrl = ({
  pagination,
  filter,
  runtimeScopeSelector,
}: {
  pagination: {
    offset: number;
    limit: number;
  };
  filter?: ApiHistoryListFilter;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
}) => {
  const query: Record<string, string | number | undefined> = {
    offset: pagination.offset,
    limit: pagination.limit,
    apiType: filter?.apiType,
    statusCode: filter?.statusCode,
    threadId: filter?.threadId,
    startDate: filter?.startDate,
    endDate: filter?.endDate,
  };

  return buildRuntimeScopeUrl(
    '/api/v1/api-history',
    query,
    runtimeScopeSelector,
  );
};

export default function useApiHistoryList({
  enabled,
  pagination,
  filter,
  runtimeScopeSelector,
  onError,
}: {
  enabled: boolean;
  pagination: {
    offset: number;
    limit: number;
  };
  filter?: ApiHistoryListFilter;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
  onError?: (error: Error) => void;
}) {
  const requestUrl = useMemo(
    () =>
      buildApiHistoryListRequestKey({
        enabled,
        pagination,
        filter,
        runtimeScopeSelector,
      }),
    [
      enabled,
      filter?.apiType,
      filter?.endDate,
      filter?.startDate,
      filter?.statusCode,
      filter?.threadId,
      pagination.limit,
      pagination.offset,
      runtimeScopeSelector?.deployHash,
      runtimeScopeSelector?.kbSnapshotId,
      runtimeScopeSelector?.knowledgeBaseId,
      runtimeScopeSelector?.runtimeScopeId,
      runtimeScopeSelector?.workspaceId,
    ],
  );
  const { data, loading } = useRestRequest<ApiHistoryListResponse | null>({
    enabled: Boolean(requestUrl),
    initialData: null,
    requestKey: requestUrl,
    request: async ({ signal }) => {
      const response = await fetch(requestUrl!, {
        signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '加载调用历史失败，请稍后重试。');
      }

      return normalizeApiHistoryListPayload(payload);
    },
    onError,
  });

  return {
    data,
    loading,
  };
}
