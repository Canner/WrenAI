import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';

type UseHomeSidebarOptions = {
  deferInitialLoad?: boolean;
  loadOnIntent?: boolean;
  disabled?: boolean;
};

type SidebarThread = {
  id: string;
  name: string;
  selector: ClientRuntimeScopeSelector;
};

type SidebarThreadRuntimeIdentity = {
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
};

type HomeSidebarThreadRecord = SidebarThreadRuntimeIdentity & {
  id: string | number;
  summary?: string | null;
};

const EMPTY_SIDEBAR_THREADS: SidebarThread[] = [];
const SIDEBAR_CACHE_TTL_MS = 20_000;
const HOME_SIDEBAR_STORAGE_PREFIX = 'wren.homeSidebar';

type SidebarCacheRecord<T> = {
  value: T;
  updatedAt: number;
};

const getHomeSidebarStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
};

const readSidebarCacheRecord = <T,>(
  key: string,
): SidebarCacheRecord<T> | null => {
  const storage = getHomeSidebarStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as SidebarCacheRecord<T>) : null;
  } catch (_error) {
    storage.removeItem(key);
    return null;
  }
};

const writeSidebarCacheRecord = <T,>(key: string, value: T) => {
  const storage = getHomeSidebarStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      key,
      JSON.stringify({
        value,
        updatedAt: Date.now(),
      } satisfies SidebarCacheRecord<T>),
    );
  } catch (_error) {
    // ignore storage write failures in restricted browsers
  }
};

export const resolveHomeSidebarScopeKey = ({
  workspaceId,
  runtimeScopeId,
}: {
  workspaceId?: string | null;
  runtimeScopeId?: string | null;
}) => workspaceId || runtimeScopeId || '__default__';

export const resolveHomeSidebarHeaderSelector = ({
  workspaceId,
  runtimeScopeId,
}: {
  workspaceId?: string | null;
  runtimeScopeId?: string | null;
}) => {
  if (workspaceId) {
    return { workspaceId };
  }

  if (runtimeScopeId) {
    return { runtimeScopeId };
  }

  return {};
};

const getHomeSidebarQueryEnabledStorageKey = (scopeKey: string) =>
  `${HOME_SIDEBAR_STORAGE_PREFIX}:queryEnabled:${scopeKey}`;

const getHomeSidebarThreadsStorageKey = (scopeKey: string) =>
  `${HOME_SIDEBAR_STORAGE_PREFIX}:threads:${scopeKey}`;

export const resolveHomeSidebarThreadSelector = (
  thread: SidebarThreadRuntimeIdentity,
): ClientRuntimeScopeSelector => {
  const workspaceId = thread.workspaceId || undefined;
  const knowledgeBaseId = thread.knowledgeBaseId || undefined;
  const kbSnapshotId = thread.kbSnapshotId || undefined;
  const deployHash = thread.deployHash || undefined;

  if (workspaceId || knowledgeBaseId || kbSnapshotId || deployHash) {
    return {
      ...(workspaceId ? { workspaceId } : {}),
      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
      ...(kbSnapshotId ? { kbSnapshotId } : {}),
      ...(deployHash ? { deployHash } : {}),
    };
  }

  return {};
};

export const buildHomeSidebarThreadsUrl = (
  selector: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl('/api/v1/threads', {}, selector);

export const buildHomeSidebarThreadDetailUrl = (
  id: string,
  selector: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl(`/api/v1/threads/${id}`, {}, selector);

export const normalizeHomeSidebarThreads = (
  payload: unknown,
): HomeSidebarThreadRecord[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload as HomeSidebarThreadRecord[];
};

export const getCachedHomeSidebarQueryEnabled = (scopeKey: string) =>
  (() => {
    const cached = readSidebarCacheRecord<boolean>(
      getHomeSidebarQueryEnabledStorageKey(scopeKey),
    );
    if (!cached) {
      return false;
    }

    if (Date.now() - cached.updatedAt > SIDEBAR_CACHE_TTL_MS) {
      getHomeSidebarStorage()?.removeItem(
        getHomeSidebarQueryEnabledStorageKey(scopeKey),
      );
      return false;
    }

    return cached.value;
  })();

export const getCachedHomeSidebarThreads = (scopeKey: string) =>
  (() => {
    const cached = readSidebarCacheRecord<SidebarThread[]>(
      getHomeSidebarThreadsStorageKey(scopeKey),
    );
    if (!cached) {
      return EMPTY_SIDEBAR_THREADS;
    }

    if (Date.now() - cached.updatedAt > SIDEBAR_CACHE_TTL_MS) {
      getHomeSidebarStorage()?.removeItem(
        getHomeSidebarThreadsStorageKey(scopeKey),
      );
      return EMPTY_SIDEBAR_THREADS;
    }

    return cached.value;
  })();

const cacheHomeSidebarQueryEnabled = (scopeKey: string) => {
  writeSidebarCacheRecord(getHomeSidebarQueryEnabledStorageKey(scopeKey), true);
};

const cacheHomeSidebarThreads = (
  scopeKey: string,
  threads: SidebarThread[],
) => {
  writeSidebarCacheRecord(
    getHomeSidebarThreadsStorageKey(scopeKey),
    threads.length === 0 ? EMPTY_SIDEBAR_THREADS : threads,
  );
};

export const shouldScheduleDeferredSidebarLoad = ({
  deferInitialLoad,
  hasRuntimeScope,
  loadOnIntent,
  queryEnabled,
}: {
  deferInitialLoad: boolean;
  hasRuntimeScope: boolean;
  loadOnIntent: boolean;
  queryEnabled: boolean;
}) => hasRuntimeScope && deferInitialLoad && !queryEnabled && !loadOnIntent;

export const shouldEnableSidebarQueryOnIntent = ({
  disabled,
  hasRuntimeScope,
  queryEnabled,
}: {
  disabled?: boolean;
  hasRuntimeScope: boolean;
  queryEnabled: boolean;
}) => !disabled && hasRuntimeScope && !queryEnabled;

export const shouldFetchHomeSidebarThreads = ({
  disabled,
  hasRuntimeScope,
  queryEnabled,
  cachedThreadCount,
}: {
  disabled?: boolean;
  hasRuntimeScope: boolean;
  queryEnabled: boolean;
  cachedThreadCount: number;
}) => !disabled && hasRuntimeScope && queryEnabled && cachedThreadCount === 0;

export const shouldEagerLoadHomeSidebarOnIntent = ({
  disabled,
  hasRuntimeScope,
  cachedThreadCount,
}: {
  disabled?: boolean;
  hasRuntimeScope: boolean;
  cachedThreadCount: number;
}) => !disabled && hasRuntimeScope && cachedThreadCount === 0;

export default function useHomeSidebar(options?: UseHomeSidebarOptions) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const { hasRuntimeScope } = runtimeScopeNavigation;
  const deferInitialLoad = Boolean(options?.deferInitialLoad);
  const loadOnIntent = Boolean(options?.loadOnIntent);
  const disabled = Boolean(options?.disabled);
  const scopeKey = resolveHomeSidebarScopeKey({
    workspaceId: runtimeScopeNavigation.selector.workspaceId,
    runtimeScopeId: runtimeScopeNavigation.selector.runtimeScopeId,
  });
  const sidebarHeaderSelector = useMemo(
    () =>
      resolveHomeSidebarHeaderSelector({
        workspaceId: runtimeScopeNavigation.selector.workspaceId,
        runtimeScopeId: runtimeScopeNavigation.selector.runtimeScopeId,
      }),
    [
      runtimeScopeNavigation.selector.runtimeScopeId,
      runtimeScopeNavigation.selector.workspaceId,
    ],
  );
  const [queryEnabled, setQueryEnabled] = useState(
    () =>
      !disabled &&
      (!deferInitialLoad || getCachedHomeSidebarQueryEnabled(scopeKey)),
  );
  const [threads, setThreads] = useState(() =>
    getCachedHomeSidebarThreads(scopeKey),
  );
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(() =>
    getCachedHomeSidebarThreads(scopeKey).length > 0,
  );
  const pendingLoadThreadsRef = useRef<{
    scopeKey: string;
    request: Promise<SidebarThread[]>;
  } | null>(null);

  useEffect(() => {
    if (disabled) {
      setQueryEnabled(false);
      return;
    }

    setQueryEnabled(
      !deferInitialLoad || getCachedHomeSidebarQueryEnabled(scopeKey),
    );
  }, [deferInitialLoad, disabled, scopeKey]);

  useEffect(() => {
    if (disabled) {
      return;
    }

    if (!hasRuntimeScope) {
      setQueryEnabled(!deferInitialLoad);
      return;
    }

    if (
      !shouldScheduleDeferredSidebarLoad({
        deferInitialLoad,
        hasRuntimeScope,
        loadOnIntent,
        queryEnabled,
      })
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setQueryEnabled(true);
    }, 420);

    return () => {
      window.clearTimeout(timer);
    };
  }, [deferInitialLoad, disabled, hasRuntimeScope, loadOnIntent, queryEnabled]);

  useEffect(() => {
    if (disabled || !hasRuntimeScope || !queryEnabled) {
      return;
    }

    cacheHomeSidebarQueryEnabled(scopeKey);
  }, [disabled, hasRuntimeScope, queryEnabled, scopeKey]);

  const cachedThreads = useMemo(
    () => getCachedHomeSidebarThreads(scopeKey),
    [scopeKey],
  );

  const syncThreads = useCallback(
    (nextThreads?: HomeSidebarThreadRecord[]) => {
      const normalizedThreads: SidebarThread[] = (nextThreads || []).map(
        (thread) => ({
          id: thread.id.toString(),
          name: thread.summary || '未命名对话',
          selector: resolveHomeSidebarThreadSelector(thread),
        }),
      );
      cacheHomeSidebarThreads(scopeKey, normalizedThreads);
      const cachedNormalizedThreads = getCachedHomeSidebarThreads(scopeKey);
      setThreads(cachedNormalizedThreads);
      return cachedNormalizedThreads;
    },
    [scopeKey],
  );

  useEffect(() => {
    if (disabled) {
      setThreads(EMPTY_SIDEBAR_THREADS);
      setLoading(false);
      setInitialized(true);
      return;
    }

    setThreads(cachedThreads);
    setInitialized(cachedThreads.length > 0);
  }, [cachedThreads, disabled, scopeKey]);

  const loadThreads = useCallback(
    async ({
      networkOnly = false,
    }: {
      networkOnly?: boolean;
    } = {}) => {
      if (disabled || !hasRuntimeScope) {
        setThreads(EMPTY_SIDEBAR_THREADS);
        setLoading(false);
        setInitialized(true);
        return EMPTY_SIDEBAR_THREADS;
      }

      if (pendingLoadThreadsRef.current?.scopeKey === scopeKey) {
        return pendingLoadThreadsRef.current.request;
      }

      setLoading(true);
      const request = fetch(buildHomeSidebarThreadsUrl(sidebarHeaderSelector), {
        cache: networkOnly ? 'no-store' : 'default',
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(payload?.error || '加载历史对话失败，请稍后重试');
          }

          return normalizeHomeSidebarThreads(payload);
        })
        .then((payload) => syncThreads(payload))
        .catch((error) => {
          message.error(error.message || '加载历史对话失败，请稍后重试');
          return getCachedHomeSidebarThreads(scopeKey);
        })
        .finally(() => {
          setLoading(false);
          setInitialized(true);
          if (pendingLoadThreadsRef.current?.request === request) {
            pendingLoadThreadsRef.current = null;
          }
        });
      pendingLoadThreadsRef.current = {
        scopeKey,
        request,
      };

      return request;
    },
    [disabled, hasRuntimeScope, scopeKey, sidebarHeaderSelector, syncThreads],
  );

  useEffect(() => {
    if (
      !shouldFetchHomeSidebarThreads({
        disabled,
        hasRuntimeScope,
        queryEnabled,
        cachedThreadCount: cachedThreads.length,
      })
    ) {
      return;
    }

    let cancelled = false;

    void loadThreads().then((nextThreads) => {
      if (cancelled) {
        return;
      }

      setThreads(nextThreads);
    });

    return () => {
      cancelled = true;
    };
  }, [
    cachedThreads.length,
    disabled,
    hasRuntimeScope,
    loadThreads,
    queryEnabled,
    scopeKey,
  ]);

  const safeRefetch = useCallback(async () => {
    if (disabled || !hasRuntimeScope) {
      return EMPTY_SIDEBAR_THREADS;
    }

    cacheHomeSidebarQueryEnabled(scopeKey);
    setQueryEnabled(true);
    return loadThreads({ networkOnly: true });
  }, [disabled, hasRuntimeScope, loadThreads, scopeKey]);

  const onSelect = useCallback(
    (selectKeys: string[], selectorOverride?: ClientRuntimeScopeSelector) => {
      runtimeScopeNavigation.push(
        `${Path.Home}/${selectKeys[0]}`,
        {},
        selectorOverride || runtimeScopeNavigation.workspaceSelector,
      );
    },
    [runtimeScopeNavigation.push, runtimeScopeNavigation.workspaceSelector],
  );

  const onRename = useCallback(
    async (id: string, newName: string) => {
      try {
        const response = await fetch(
          buildHomeSidebarThreadDetailUrl(id, sidebarHeaderSelector),
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ summary: newName }),
          },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || '更新对话失败，请稍后重试');
        }

        await safeRefetch();
      } catch (error: any) {
        message.error(error?.message || '更新对话失败，请稍后重试');
      }
    },
    [safeRefetch, sidebarHeaderSelector],
  );

  const onDelete = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(
          buildHomeSidebarThreadDetailUrl(id, sidebarHeaderSelector),
          {
            method: 'DELETE',
          },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || '删除对话失败，请稍后重试');
        }

        await safeRefetch();
      } catch (error: any) {
        message.error(error?.message || '删除对话失败，请稍后重试');
      }
    },
    [safeRefetch, sidebarHeaderSelector],
  );

  const ensureLoaded = useCallback(() => {
    if (disabled || !hasRuntimeScope) {
      return;
    }

    const canEnableQuery = shouldEnableSidebarQueryOnIntent({
      disabled,
      hasRuntimeScope,
      queryEnabled,
    });
    if (canEnableQuery) {
      cacheHomeSidebarQueryEnabled(scopeKey);
      setQueryEnabled(true);
    }

    if (
      !shouldEagerLoadHomeSidebarOnIntent({
        disabled,
        hasRuntimeScope,
        cachedThreadCount: getCachedHomeSidebarThreads(scopeKey).length,
      })
    ) {
      return;
    }

    void loadThreads().then((nextThreads) => {
      setThreads(nextThreads);
    });
  }, [disabled, hasRuntimeScope, loadThreads, queryEnabled, scopeKey]);

  return useMemo(
    () => ({
      data: { threads },
      loading,
      initialized,
      onSelect,
      onRename,
      onDelete,
      refetch: safeRefetch,
      ensureLoaded,
    }),
    [
      ensureLoaded,
      initialized,
      loading,
      onDelete,
      onRename,
      onSelect,
      safeRefetch,
      threads,
    ],
  );
}
