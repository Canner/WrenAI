import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';
import type { ClientRuntimeScopeSelector } from '@/apollo/client/runtimeScope';
import { loadDashboardListPayload } from '@/utils/dashboardRest';
import { loadKnowledgeDiagramPayload } from '@/utils/knowledgeDiagramRest';

type WorkspaceFetchErrorPayload = {
  error?: string;
};

type TimedCacheEntry<T = unknown> = {
  value: T;
  updatedAt: number;
};

const PREFETCH_CACHE_TTL_MS = 30_000;

const workspaceOverviewCache = new Map<string, TimedCacheEntry>();
const workspaceOverviewRequestCache = new Map<string, Promise<unknown>>();
const knowledgeOverviewCache = new Map<string, TimedCacheEntry>();
const knowledgeOverviewRequestCache = new Map<string, Promise<unknown>>();
const threadOverviewCache = new Map<number, TimedCacheEntry>();
const threadOverviewRequestCache = new Map<number, Promise<unknown>>();
let prefetchedFirstDashboardId: number | null = null;

export const clearRuntimePagePrefetchCache = () => {
  workspaceOverviewCache.clear();
  workspaceOverviewRequestCache.clear();
  knowledgeOverviewCache.clear();
  knowledgeOverviewRequestCache.clear();
  threadOverviewCache.clear();
  threadOverviewRequestCache.clear();
  prefetchedFirstDashboardId = null;
};

const getFreshCachedValue = <T = unknown>(
  cache: Map<string, TimedCacheEntry>,
  key: string,
): T | null => {
  const cachedEntry = cache.get(key);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() - cachedEntry.updatedAt > PREFETCH_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return cachedEntry.value as T;
};

const getFreshThreadCachedValue = <T = unknown>(threadId: number): T | null => {
  const cachedEntry = threadOverviewCache.get(threadId);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() - cachedEntry.updatedAt > PREFETCH_CACHE_TTL_MS) {
    threadOverviewCache.delete(threadId);
    return null;
  }

  return cachedEntry.value as T;
};

export const primeThreadOverview = <T = unknown>(
  threadId: number,
  value: T,
) => {
  threadOverviewCache.set(threadId, {
    value,
    updatedAt: Date.now(),
  });
};

const loadCachedJson = async <T = unknown>(
  url: string,
  {
    cache,
    requestCache,
    fetcher = fetch,
    errorMessage,
  }: {
    cache: Map<string, TimedCacheEntry>;
    requestCache: Map<string, Promise<unknown>>;
    fetcher?: typeof fetch;
    errorMessage: string;
  },
): Promise<T> => {
  const cachedPayload = getFreshCachedValue<T>(cache, url);
  if (cachedPayload) {
    return cachedPayload;
  }

  const pendingRequest = requestCache.get(url);
  if (pendingRequest) {
    return pendingRequest as Promise<T>;
  }

  const request = fetcher(url)
    .then(async (response) => {
      const payload = ((await response.json()) || {}) as T &
        WorkspaceFetchErrorPayload;

      if (!response.ok) {
        throw new Error(payload.error || errorMessage);
      }

      cache.set(url, {
        value: payload,
        updatedAt: Date.now(),
      });
      return payload;
    })
    .finally(() => {
      requestCache.delete(url);
    });

  requestCache.set(url, request);
  return request as Promise<T>;
};

export const loadWorkspaceOverview = async <T = unknown>(
  url: string,
  {
    fetcher = fetch,
  }: {
    fetcher?: typeof fetch;
  } = {},
): Promise<T> => {
  return loadCachedJson<T>(url, {
    cache: workspaceOverviewCache,
    requestCache: workspaceOverviewRequestCache,
    fetcher,
    errorMessage: '加载工作区信息失败',
  });
};

export const peekWorkspaceOverview = <T = unknown>(url: string): T | null =>
  getFreshCachedValue<T>(workspaceOverviewCache, url);

export const loadKnowledgeBaseList = async <T = unknown>(
  url: string,
  {
    fetcher = fetch,
  }: {
    fetcher?: typeof fetch;
  } = {},
): Promise<T> =>
  loadCachedJson<T>(url, {
    cache: knowledgeOverviewCache,
    requestCache: knowledgeOverviewRequestCache,
    fetcher,
    errorMessage: '加载知识库失败',
  });

export const peekKnowledgeBaseList = <T = unknown>(url: string): T | null =>
  getFreshCachedValue<T>(knowledgeOverviewCache, url);

export const peekThreadOverview = <T = unknown>(threadId: number): T | null => {
  return getFreshThreadCachedValue<T>(threadId);
};

export const buildThreadOverviewUrl = (
  threadId: number,
  selector?: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl(`/api/v1/threads/${threadId}`, {}, selector);

export const peekPrefetchedFirstDashboardId = () => prefetchedFirstDashboardId;

export const loadKnowledgeConnectors = async <T = unknown>(
  url: string,
  {
    fetcher = fetch,
  }: {
    fetcher?: typeof fetch;
  } = {},
): Promise<T> =>
  loadCachedJson<T>(url, {
    cache: knowledgeOverviewCache,
    requestCache: knowledgeOverviewRequestCache,
    fetcher,
    errorMessage: '加载数据源失败',
  });

export const prefetchKnowledgeOverview = async ({
  knowledgeBasesUrl,
  connectorsUrl,
  diagramUrl,
  fetcher = fetch,
}: {
  knowledgeBasesUrl: string;
  connectorsUrl?: string;
  diagramUrl?: string;
  fetcher?: typeof fetch;
}) => {
  try {
    await Promise.all([
      loadKnowledgeBaseList(knowledgeBasesUrl, { fetcher }),
      connectorsUrl
        ? loadKnowledgeConnectors(connectorsUrl, { fetcher })
        : Promise.resolve(),
      diagramUrl
        ? loadKnowledgeDiagramPayload({
            requestUrl: diagramUrl,
            fetcher,
            useCache: true,
          })
        : Promise.resolve(),
    ]);
  } catch {
    // ignore background prefetch failures; page load still retries normally
  }
};

export const prefetchWorkspaceOverview = async (url: string) => {
  try {
    await loadWorkspaceOverview(url);
  } catch {
    // ignore background prefetch failures; page load still retries normally
  }
};

export const prefetchDashboardOverview = async ({
  selector,
  fetcher = fetch,
}: {
  selector?: ClientRuntimeScopeSelector;
  fetcher?: typeof fetch;
} = {}) => {
  try {
    const dashboards = await loadDashboardListPayload({
      selector,
      fetcher,
      useCache: true,
    });
    const firstDashboardId = dashboards?.[0]?.id;
    prefetchedFirstDashboardId = firstDashboardId ?? null;
  } catch {
    // ignore background prefetch failures; target page will handle its own error
  }
};

export const prefetchThreadOverview = async (
  threadId: number,
  {
    selector,
    fetcher = fetch,
  }: {
    selector?: ClientRuntimeScopeSelector;
    fetcher?: typeof fetch;
  } = {},
) => {
  const cachedThreadOverview = getFreshThreadCachedValue(threadId);
  if (cachedThreadOverview) {
    return cachedThreadOverview;
  }

  const pendingRequest = threadOverviewRequestCache.get(threadId);
  if (pendingRequest) {
    await pendingRequest;
    return;
  }

  try {
    const request = fetcher(buildThreadOverviewUrl(threadId, selector))
      .then(async (response) => {
        const payload = ((await response.json()) || {}) as Record<
          string,
          unknown
        > &
          WorkspaceFetchErrorPayload;

        if (!response.ok) {
          throw new Error(payload.error || '加载对话失败');
        }

        const result = {
          thread: payload,
        };
        primeThreadOverview(threadId, result);
        return result;
      })
      .finally(() => {
        threadOverviewRequestCache.delete(threadId);
      });

    threadOverviewRequestCache.set(threadId, request);
    await request;
  } catch {
    threadOverviewRequestCache.delete(threadId);
    // ignore background prefetch failures; target page will handle its own error
  }
};
