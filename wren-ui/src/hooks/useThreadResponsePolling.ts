import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type { ThreadResponse } from '@/types/home';

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
  const [data, setData] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingSessionRef = useRef(0);

  const stopPolling = useCallback(() => {
    pollingSessionRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchById = useCallback(
    async (responseId: number) => {
      const sessionId = pollingSessionRef.current + 1;
      pollingSessionRef.current = sessionId;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setLoading(true);

      const run = async (): Promise<ThreadResponse | null> => {
        try {
          const nextResponse = await loadThreadResponsePayload({
            responseId,
            runtimeScopeSelector,
          });

          if (pollingSessionRef.current !== sessionId) {
            return nextResponse;
          }

          setData(nextResponse);
          onCompleted?.(nextResponse);
          timerRef.current = setTimeout(() => {
            void run();
          }, pollInterval);
          return nextResponse;
        } catch (error) {
          if (pollingSessionRef.current === sessionId) {
            onError?.(
              error instanceof Error
                ? error
                : new Error('加载对话结果失败，请稍后重试'),
            );
          }
          return null;
        } finally {
          if (pollingSessionRef.current === sessionId) {
            setLoading(false);
          }
        }
      };

      return run();
    },
    [onCompleted, onError, pollInterval, runtimeScopeSelector],
  );

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    data,
    loading,
    fetchById,
    stopPolling,
  };
}
