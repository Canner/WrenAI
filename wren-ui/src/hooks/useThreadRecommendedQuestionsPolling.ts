import { useCallback } from 'react';
import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type { RecommendedQuestionsTask } from '@/types/home';
import usePollingRequestLoop from './usePollingRequestLoop';

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
  const { data, loading, startPolling, stopPolling } =
    usePollingRequestLoop<RecommendedQuestionsTask>({
      pollInterval,
      onCompleted,
      onError,
      shouldContinueOnError: () => true,
    });

  const fetchByThreadId = useCallback(
    (threadId: number) =>
      startPolling(() =>
        loadThreadRecommendationQuestionsPayload({
          threadId,
          runtimeScopeSelector,
        }),
      ),
    [runtimeScopeSelector, startPolling],
  );

  return {
    data,
    loading,
    fetchByThreadId,
    stopPolling,
  };
}
