import { useCallback } from 'react';
import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type { ThreadResponse } from '@/types/home';
import usePollingRequestLoop from './usePollingRequestLoop';

const NON_RECOVERABLE_THREAD_RESPONSE_ERROR_PATTERNS = [
  /does not belong to the current runtime scope/i,
  /\bnot found\b/i,
  /\binvalid\b/i,
];

export class ThreadResponseRequestError extends Error {
  statusCode?: number;
  code?: string;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      code?: string;
    },
  ) {
    super(message);
    this.name = 'ThreadResponseRequestError';
    this.statusCode = options?.statusCode;
    this.code = options?.code;
  }
}

export const shouldRetryThreadResponsePollingError = (error: Error) => {
  const statusCodeCandidate = (error as { statusCode?: unknown }).statusCode;
  const statusCode =
    typeof statusCodeCandidate === 'number' ? statusCodeCandidate : null;

  if (statusCode != null && statusCode >= 400 && statusCode < 500) {
    return false;
  }

  return !NON_RECOVERABLE_THREAD_RESPONSE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(error.message),
  );
};

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
    throw new ThreadResponseRequestError(
      payload?.error || '加载对话结果失败，请稍后重试',
      {
        statusCode: response.status,
        code: typeof payload?.code === 'string' ? payload.code : undefined,
      },
    );
  }

  const normalized = normalizeThreadResponsePayload(payload);
  if (!normalized) {
    throw new ThreadResponseRequestError('加载对话结果失败，请稍后重试');
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
      shouldContinueOnError: shouldRetryThreadResponsePollingError,
    });

  const fetchById = useCallback(
    (
      responseId: number,
      runtimeScopeSelectorOverride?: ClientRuntimeScopeSelector,
    ) =>
      startPolling(() =>
        loadThreadResponsePayload({
          responseId,
          runtimeScopeSelector:
            runtimeScopeSelectorOverride || runtimeScopeSelector,
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
