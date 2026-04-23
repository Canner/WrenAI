import { useCallback, useEffect, useMemo } from 'react';
import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type { DetailedThread } from '@/types/home';
import {
  peekThreadOverview,
  primeThreadOverview,
} from '@/utils/runtimePagePrefetch';
import useRestRequest from './useRestRequest';

const EMPTY_THREAD_DETAIL_RETRY_INTERVAL_MS = 500;
const EMPTY_THREAD_DETAIL_MAX_RETRIES = 8;

export type ThreadDetailData = DetailedThread;
export type ThreadDetailStateData = {
  thread: ThreadDetailData;
};
export type UpdateThreadDetailState = (
  updater: (prev: ThreadDetailStateData) => ThreadDetailStateData,
) => void;

const threadDetailRequests = new Map<string, Promise<ThreadDetailData>>();

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const clearThreadDetailRequestCache = () => {
  threadDetailRequests.clear();
};

export const buildThreadDetailUrl = ({
  threadId,
  runtimeScopeSelector,
}: {
  threadId: number;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
}) =>
  buildRuntimeScopeUrl(`/api/v1/threads/${threadId}`, {}, runtimeScopeSelector);

export const buildThreadDetailRequestKey = ({
  enabled,
  threadId,
  runtimeScopeSelector,
}: {
  enabled: boolean;
  threadId?: number | null;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
}) =>
  enabled && threadId != null
    ? buildThreadDetailUrl({
        threadId,
        runtimeScopeSelector,
      })
    : null;

export const normalizeThreadDetailPayload = (
  payload: unknown,
): ThreadDetailData | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const normalized = payload as Partial<ThreadDetailData>;
  if (
    typeof normalized.id !== 'number' ||
    !Array.isArray(normalized.responses)
  ) {
    return null;
  }

  return normalized as ThreadDetailData;
};

export const shouldRefetchEmptyThreadDetail = (
  payload?: ThreadDetailData | null,
) => Boolean(payload && payload.responses.length === 0);

const getCachedThreadDetail = (
  threadId?: number | null,
  runtimeScopeSelector?: ClientRuntimeScopeSelector,
) => {
  if (threadId == null) {
    return null;
  }

  return peekThreadOverview<ThreadDetailStateData>(
    threadId,
    runtimeScopeSelector,
  );
};

export const loadThreadDetailPayload = async ({
  threadId,
  runtimeScopeSelector,
  requestUrl,
  fetcher = fetch,
  preferPrefetchedData = true,
}: {
  threadId: number;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  fetcher?: typeof fetch;
  preferPrefetchedData?: boolean;
}): Promise<ThreadDetailData> => {
  const cachedThread = getCachedThreadDetail(
    threadId,
    runtimeScopeSelector,
  )?.thread;
  if (preferPrefetchedData && cachedThread) {
    return cachedThread;
  }

  const resolvedRequestUrl =
    requestUrl ||
    buildThreadDetailUrl({
      threadId,
      runtimeScopeSelector,
    });
  const pendingRequest = threadDetailRequests.get(resolvedRequestUrl);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = fetcher(resolvedRequestUrl, { cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '加载对话失败，已返回首页');
      }

      const normalized = normalizeThreadDetailPayload(payload);
      if (!normalized) {
        throw new Error('加载对话失败，已返回首页');
      }

      primeThreadOverview(
        threadId,
        {
          thread: normalized,
        } satisfies ThreadDetailStateData,
        runtimeScopeSelector,
      );
      return normalized;
    })
    .finally(() => {
      threadDetailRequests.delete(resolvedRequestUrl);
    });

  threadDetailRequests.set(resolvedRequestUrl, request);
  return request;
};

export const loadThreadDetailPayloadWithRetry = async ({
  threadId,
  runtimeScopeSelector,
  requestUrl,
  fetcher = fetch,
  preferPrefetchedData = true,
  maxRetries = EMPTY_THREAD_DETAIL_MAX_RETRIES,
  retryIntervalMs = EMPTY_THREAD_DETAIL_RETRY_INTERVAL_MS,
  waitForRetry = wait,
}: {
  threadId: number;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  fetcher?: typeof fetch;
  preferPrefetchedData?: boolean;
  maxRetries?: number;
  retryIntervalMs?: number;
  waitForRetry?: (ms: number) => Promise<void>;
}): Promise<ThreadDetailData> => {
  let payload = await loadThreadDetailPayload({
    threadId,
    runtimeScopeSelector,
    requestUrl,
    fetcher,
    preferPrefetchedData,
  });

  for (
    let attempt = 0;
    attempt < maxRetries && shouldRefetchEmptyThreadDetail(payload);
    attempt += 1
  ) {
    await waitForRetry(retryIntervalMs);
    payload = await loadThreadDetailPayload({
      threadId,
      runtimeScopeSelector,
      requestUrl,
      fetcher,
      preferPrefetchedData: false,
    });
  }

  return payload;
};

export default function useThreadDetail({
  threadId,
  enabled,
  runtimeScopeSelector,
  onError,
}: {
  threadId?: number | null;
  enabled: boolean;
  runtimeScopeSelector?: ClientRuntimeScopeSelector;
  onError?: (error: Error) => void;
}) {
  const requestUrl = useMemo(() => {
    return buildThreadDetailRequestKey({
      enabled,
      threadId,
      runtimeScopeSelector,
    });
  }, [enabled, runtimeScopeSelector, threadId]);

  const prefetchedData = useMemo(
    () => getCachedThreadDetail(threadId, runtimeScopeSelector),
    [runtimeScopeSelector, threadId],
  );
  const shouldRevalidatePrefetchedData = useMemo(
    () => shouldRefetchEmptyThreadDetail(prefetchedData?.thread),
    [prefetchedData],
  );
  const shouldAutoFetch = Boolean(
    requestUrl && (!prefetchedData || shouldRevalidatePrefetchedData),
  );
  const { data, loading, setData } = useRestRequest<
    ThreadDetailStateData | null,
    ThreadDetailData
  >({
    enabled: Boolean(requestUrl),
    auto: shouldAutoFetch,
    initialData: prefetchedData,
    requestKey: requestUrl,
    request: async () =>
      loadThreadDetailPayloadWithRetry({
        threadId: threadId as number,
        runtimeScopeSelector,
        requestUrl: requestUrl as string,
        preferPrefetchedData: false,
      }),
    mapResult: (thread) => ({
      thread,
    }),
    onError: (error) => {
      onError?.(
        error instanceof Error ? error : new Error('加载对话失败，已返回首页'),
      );
    },
  });

  useEffect(() => {
    setData(prefetchedData);
  }, [prefetchedData, setData]);

  const activeData = useMemo(() => {
    if (threadId == null) {
      return null;
    }

    if (data?.thread?.id === threadId) {
      return data;
    }

    return prefetchedData;
  }, [data, prefetchedData, threadId]);

  const updateQuery = useCallback<UpdateThreadDetailState>(
    (updater) => {
      setData((previousData) => {
        const baseData =
          previousData?.thread?.id === threadId
            ? previousData
            : getCachedThreadDetail(threadId, runtimeScopeSelector);
        if (!baseData || threadId == null) {
          return previousData;
        }

        const nextData = updater(baseData);
        primeThreadOverview(threadId, nextData, runtimeScopeSelector);
        return nextData;
      });
    },
    [runtimeScopeSelector, threadId],
  );

  return {
    data: activeData,
    loading,
    updateQuery,
  };
}
