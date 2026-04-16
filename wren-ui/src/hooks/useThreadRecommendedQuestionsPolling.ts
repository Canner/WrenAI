import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import type { RecommendedQuestionsTask } from '@/types/api';

export const buildThreadRecommendationQuestionsUrl = ({
  threadId,
  runtimeScopeSelector,
}: {
  threadId: number;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
}) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-recommendation-questions/${threadId}`,
    {},
    runtimeScopeSelector,
  );

export const normalizeThreadRecommendationQuestionsPayload = (
  payload: unknown,
): RecommendedQuestionsTask | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const normalized = payload as Partial<RecommendedQuestionsTask>;
  if (!normalized.status || !Array.isArray(normalized.questions)) {
    return null;
  }

  return normalized as RecommendedQuestionsTask;
};

export const loadThreadRecommendationQuestionsPayload = async ({
  threadId,
  runtimeScopeSelector,
  requestUrl,
  fetcher = fetch,
}: {
  threadId: number;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  fetcher?: typeof fetch;
}) => {
  const resolvedRequestUrl =
    requestUrl ||
    buildThreadRecommendationQuestionsUrl({
      threadId,
      runtimeScopeSelector,
    });
  const response = await fetcher(resolvedRequestUrl, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || '加载推荐追问失败，请稍后重试');
  }

  const normalized = normalizeThreadRecommendationQuestionsPayload(payload);
  if (!normalized) {
    throw new Error('加载推荐追问失败，请稍后重试');
  }

  return normalized;
};

export default function useThreadRecommendedQuestionsPolling({
  runtimeScopeSelector,
  pollInterval = 1500,
  onCompleted,
  onError,
}: {
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
  pollInterval?: number;
  onCompleted?: (task: RecommendedQuestionsTask) => void;
  onError?: (error: Error) => void;
}) {
  const [data, setData] = useState<RecommendedQuestionsTask | null>(null);
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

  const fetchByThreadId = useCallback(
    async (threadId: number) => {
      const sessionId = pollingSessionRef.current + 1;
      pollingSessionRef.current = sessionId;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setLoading(true);

      const run = async (): Promise<RecommendedQuestionsTask | null> => {
        try {
          const nextTask = await loadThreadRecommendationQuestionsPayload({
            threadId,
            runtimeScopeSelector,
          });

          if (pollingSessionRef.current !== sessionId) {
            return nextTask;
          }

          setData(nextTask);
          onCompleted?.(nextTask);
          timerRef.current = setTimeout(() => {
            void run();
          }, pollInterval);
          return nextTask;
        } catch (error) {
          if (pollingSessionRef.current === sessionId) {
            onError?.(
              error instanceof Error
                ? error
                : new Error('加载推荐追问失败，请稍后重试'),
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
    fetchByThreadId,
    stopPolling,
  };
}
