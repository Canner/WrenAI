import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  loadDashboardDetailPayload,
  loadDashboardListPayload,
} from '@/utils/dashboardRest';
import { loadKnowledgeDiagramPayload } from '@/utils/knowledgeDiagramRest';

type WorkspaceFetchErrorPayload = {
  error?: string;
};

type TimedCacheEntry<T = unknown> = {
  value: T;
  updatedAt: number;
};

const PREFETCH_CACHE_TTL_MS = 30_000;
const PREFETCH_STORAGE_PREFIX = 'wren.runtimePrefetch:';

const workspaceOverviewCache = new Map<string, TimedCacheEntry>();
const workspaceOverviewRequestCache = new Map<string, Promise<unknown>>();
const knowledgeOverviewCache = new Map<string, TimedCacheEntry>();
const knowledgeOverviewRequestCache = new Map<string, Promise<unknown>>();
const threadOverviewCache = new Map<number, TimedCacheEntry>();
const threadOverviewRequestCache = new Map<number, Promise<unknown>>();
let prefetchedFirstDashboardId: number | null = null;

const getPrefetchStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

const getPrefetchStorageKey = (scope: string, key: string) =>
  `${PREFETCH_STORAGE_PREFIX}${scope}:${key}`;

const getPrefetchStorageKeys = (storage: Storage, prefix: string) => {
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) {
      keys.push(key);
    }
  }

  return keys;
};

const readStoredPrefetchEntry = <T = unknown>(
  scope: string,
  key: string,
): TimedCacheEntry<T> | null => {
  const storage = getPrefetchStorage();
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(getPrefetchStorageKey(scope, key));
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as TimedCacheEntry<T> | null;
    if (!parsed || typeof parsed.updatedAt !== 'number') {
      storage.removeItem(getPrefetchStorageKey(scope, key));
      return null;
    }

    return parsed;
  } catch (_error) {
    return null;
  }
};

const writeStoredPrefetchEntry = <T = unknown>(
  scope: string,
  key: string,
  entry: TimedCacheEntry<T>,
) => {
  const storage = getPrefetchStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(getPrefetchStorageKey(scope, key), JSON.stringify(entry));
  } catch (_error) {
    // ignore sessionStorage write failures
  }
};

const removeStoredPrefetchEntry = (scope: string, key: string) => {
  const storage = getPrefetchStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(getPrefetchStorageKey(scope, key));
  } catch (_error) {
    // ignore sessionStorage cleanup failures
  }
};

export const clearRuntimePagePrefetchCache = () => {
  workspaceOverviewCache.clear();
  workspaceOverviewRequestCache.clear();
  knowledgeOverviewCache.clear();
  knowledgeOverviewRequestCache.clear();
  threadOverviewCache.clear();
  threadOverviewRequestCache.clear();
  prefetchedFirstDashboardId = null;

  const storage = getPrefetchStorage();
  if (!storage) {
    return;
  }

  try {
    const keysToRemove = getPrefetchStorageKeys(
      storage,
      PREFETCH_STORAGE_PREFIX,
    );
    keysToRemove.forEach((key) => storage.removeItem(key));
  } catch (_error) {
    // ignore sessionStorage cleanup failures
  }
};

const getFreshCachedValue = <T = unknown>(
  cache: Map<string, TimedCacheEntry>,
  key: string,
  scope = 'shared',
): T | null => {
  const inMemoryEntry = cache.get(key) || null;
  const cachedEntry = inMemoryEntry || readStoredPrefetchEntry<T>(scope, key);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() - cachedEntry.updatedAt > PREFETCH_CACHE_TTL_MS) {
    cache.delete(key);
    removeStoredPrefetchEntry(scope, key);
    return null;
  }

  if (!inMemoryEntry) {
    cache.set(key, cachedEntry);
  }

  return cachedEntry.value as T;
};

const getFreshThreadCachedValue = <T = unknown>(threadId: number): T | null => {
  const cacheKey = `${threadId}`;
  const inMemoryEntry = threadOverviewCache.get(threadId) || null;
  const cachedEntry =
    inMemoryEntry || readStoredPrefetchEntry<T>('thread', cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() - cachedEntry.updatedAt > PREFETCH_CACHE_TTL_MS) {
    threadOverviewCache.delete(threadId);
    removeStoredPrefetchEntry('thread', cacheKey);
    return null;
  }

  if (!inMemoryEntry) {
    threadOverviewCache.set(threadId, cachedEntry);
  }

  return cachedEntry.value as T;
};

export const primeThreadOverview = <T = unknown>(
  threadId: number,
  value: T,
) => {
  const entry = {
    value,
    updatedAt: Date.now(),
  };

  threadOverviewCache.set(threadId, entry);
  writeStoredPrefetchEntry('thread', `${threadId}`, entry);
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

      const entry = {
        value: payload,
        updatedAt: Date.now(),
      };
      cache.set(url, entry);
      writeStoredPrefetchEntry('shared', url, entry);
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

export const primeKnowledgeBaseList = <T = unknown>({
  url,
  payload,
}: {
  url: string;
  payload: T;
}) => {
  const entry = {
    value: payload,
    updatedAt: Date.now(),
  };

  knowledgeOverviewCache.set(url, entry);
  writeStoredPrefetchEntry('shared', url, entry);
};

export const invalidateKnowledgeBaseList = (url?: string | null) => {
  if (!url) {
    knowledgeOverviewCache.clear();
    knowledgeOverviewRequestCache.clear();
    return;
  }

  knowledgeOverviewCache.delete(url);
  knowledgeOverviewRequestCache.delete(url);
  removeStoredPrefetchEntry('shared', url);
};

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
    errorMessage: '加载连接器失败',
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

    if (firstDashboardId != null) {
      await loadDashboardDetailPayload({
        dashboardId: firstDashboardId,
        selector,
        fetcher,
        useCache: true,
      });
    }
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
