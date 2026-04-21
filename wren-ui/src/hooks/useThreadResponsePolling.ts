import { useCallback } from 'react';
import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type { ThreadResponse } from '@/types/home';
import usePollingRequestLoop from './usePollingRequestLoop';

export const buildThreadResponseDetailUrl = ({
  responseId,
  runtimeScopeSelector,
}: {
  responseId: number;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
}) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}`,
    {},
    runtimeScopeSelector,
  );

export const normalizeThreadResponsePayload = (
  payload: unknown,
): ThreadResponse | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const normalized = payload as Partial<ThreadResponse>;
  if (
    typeof normalized.id !== 'number' ||
    typeof normalized.threadId !== 'number'
  ) {
    return null;
  }

  return normalized as ThreadResponse;
};

export const loadThreadResponsePayload = async ({
  responseId,
  runtimeScopeSelector,
  requestUrl,
  fetcher = fetch,
}: {
  responseId: number;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  fetcher?: typeof fetch;
}) => {
  const resolvedRequestUrl =
    requestUrl ||
    buildThreadResponseDetailUrl({
      responseId,
      runtimeScopeSelector,
    });
  const response = await fetcher(resolvedRequestUrl, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || '加载对话结果失败，请稍后重试');
  }

  const normalized = normalizeThreadResponsePayload(payload);
  if (!normalized) {
    throw new Error('加载对话结果失败，请稍后重试');
  }

  return normalized;
};

export default function useThreadResponsePolling({
  runtimeScopeSelector,
  pollInterval = 1500,
  onCompleted,
  onError,
}: {
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
  pollInterval?: number;
  onCompleted?: (response: ThreadResponse) => void;
  onError?: (error: Error) => void;
}) {
  const { data, loading, startPolling, stopPolling } =
    usePollingRequestLoop<ThreadResponse>({
      pollInterval,
      onCompleted,
      onError,
      shouldContinueOnError: () => true,
    });

  const fetchById = useCallback(
    (responseId: number) =>
      startPolling(() =>
        loadThreadResponsePayload({
          responseId,
          runtimeScopeSelector,
        }),
      ),
    [runtimeScopeSelector, startPolling],
  );

  return {
    data,
    loading,
    fetchById,
    stopPolling,
  };
}
