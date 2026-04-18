import { useEffect, useMemo, useState } from 'react';
import { ApiType } from '@/types/apiHistory';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { abortWithReason, isAbortRequestError } from '@/utils/abort';

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
  const [data, setData] = useState<ApiHistoryListResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const requestUrl = useMemo(() => {
    if (!enabled) {
      return null;
    }

    return buildApiHistoryListUrl({
      pagination,
      filter,
      runtimeScopeSelector,
    });
  }, [enabled, filter, pagination, runtimeScopeSelector]);

  useEffect(() => {
    if (!requestUrl) {
      setData(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);

    void fetch(requestUrl, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || '加载调用历史失败，请稍后重试。');
        }

        return normalizeApiHistoryListPayload(payload);
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setData(payload);
      })
      .catch((error) => {
        if (
          cancelled ||
          controller.signal.aborted ||
          isAbortRequestError(error)
        ) {
          return;
        }

        onError?.(
          error instanceof Error
            ? error
            : new Error('加载调用历史失败，请稍后重试。'),
        );
      })
      .finally(() => {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        setLoading(false);
      });

    return () => {
      cancelled = true;
      abortWithReason(controller, 'api-history-request-cancelled');
    };
  }, [onError, requestUrl]);

  return {
    data,
    loading,
  };
}
