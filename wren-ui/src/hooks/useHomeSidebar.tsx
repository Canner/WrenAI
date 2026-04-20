import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { type ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useRestRequest from './useRestRequest';
import {
  deleteHomeSidebarThread,
  loadHomeSidebarThreadsPayload,
  renameHomeSidebarThread,
} from './homeSidebarRequests';
import {
  EMPTY_SIDEBAR_THREADS,
  buildHomeSidebarThreadsRequestKey,
  cacheHomeSidebarQueryEnabled,
  cacheHomeSidebarThreads,
  getCachedHomeSidebarQueryEnabled,
  getCachedHomeSidebarThreads,
  resolveHomeSidebarHeaderSelector,
  resolveHomeSidebarScopeKey,
  resolveHomeSidebarThreadSelector,
  shouldEagerLoadHomeSidebarOnIntent,
  shouldEnableSidebarQueryOnIntent,
  shouldFetchHomeSidebarThreads,
  shouldScheduleDeferredSidebarLoad,
  type HomeSidebarThreadRecord,
  type SidebarThread,
} from './homeSidebarHelpers';

export {
  buildHomeSidebarThreadDetailUrl,
  buildHomeSidebarThreadsRequestKey,
  buildHomeSidebarThreadsUrl,
  getCachedHomeSidebarQueryEnabled,
  getCachedHomeSidebarThreads,
  normalizeHomeSidebarThreads,
  resolveHomeSidebarHeaderSelector,
  resolveHomeSidebarScopeKey,
  resolveHomeSidebarThreadSelector,
  shouldEagerLoadHomeSidebarOnIntent,
  shouldEnableSidebarQueryOnIntent,
  shouldFetchHomeSidebarThreads,
  shouldScheduleDeferredSidebarLoad,
} from './homeSidebarHelpers';

type UseHomeSidebarOptions = {
  deferInitialLoad?: boolean;
  loadOnIntent?: boolean;
  disabled?: boolean;
};

export default function useHomeSidebar(options?: UseHomeSidebarOptions) {
  // Intentional partial exception:
  // sessionStorage warm cache + intent/deferred enablement stay local here,
  // while the primary threads GET path now reuses `useRestRequest`.
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
  const [initialized, setInitialized] = useState(
    () => getCachedHomeSidebarThreads(scopeKey).length > 0,
  );
  const requestCacheModeRef = useRef<RequestCache>('default');

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
      setInitialized(true);
      return;
    }

    setThreads(cachedThreads);
    setInitialized(cachedThreads.length > 0);
  }, [cachedThreads, disabled, scopeKey]);

  const requestUrl = useMemo(
    () => buildHomeSidebarThreadsRequestKey(sidebarHeaderSelector),
    [sidebarHeaderSelector],
  );
  const {
    loading,
    refetch: refetchThreads,
    cancel: cancelThreadsRequest,
  } = useRestRequest<SidebarThread[], HomeSidebarThreadRecord[]>({
    enabled: !disabled && hasRuntimeScope && queryEnabled,
    auto: false,
    initialData: EMPTY_SIDEBAR_THREADS,
    requestKey: requestUrl,
    request: ({ signal }) =>
      loadHomeSidebarThreadsPayload({
        requestUrl,
        cacheMode: requestCacheModeRef.current,
        signal,
      }),
    mapResult: syncThreads,
    onSuccess: () => {
      setInitialized(true);
    },
    onError: (error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载历史对话失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      setInitialized(true);
    },
    resetDataOnDisable: false,
  });

  useEffect(() => cancelThreadsRequest, [cancelThreadsRequest]);

  const loadThreads = useCallback(
    async ({
      networkOnly = false,
    }: {
      networkOnly?: boolean;
    } = {}) => {
      if (disabled || !hasRuntimeScope) {
        setThreads(EMPTY_SIDEBAR_THREADS);
        setInitialized(true);
        return EMPTY_SIDEBAR_THREADS;
      }

      requestCacheModeRef.current = networkOnly ? 'no-store' : 'default';

      try {
        return await refetchThreads();
      } catch (_error) {
        const cachedFallback = getCachedHomeSidebarThreads(scopeKey);
        setThreads(cachedFallback);
        return cachedFallback;
      } finally {
        requestCacheModeRef.current = 'default';
      }
    },
    [disabled, hasRuntimeScope, refetchThreads, scopeKey],
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

    void loadThreads();
  }, [
    cachedThreads.length,
    disabled,
    hasRuntimeScope,
    loadThreads,
    queryEnabled,
  ]);

  const safeRefetch = useCallback(async () => {
    if (disabled || !hasRuntimeScope) {
      return EMPTY_SIDEBAR_THREADS;
    }

    cacheHomeSidebarQueryEnabled(scopeKey);
    if (!queryEnabled) {
      setQueryEnabled(true);
      return getCachedHomeSidebarThreads(scopeKey);
    }

    return loadThreads({ networkOnly: true });
  }, [disabled, hasRuntimeScope, loadThreads, queryEnabled, scopeKey]);

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
        await renameHomeSidebarThread({
          id,
          summary: newName,
          selector: sidebarHeaderSelector,
        });
        await safeRefetch();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '更新对话失败，请稍后重试',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    },
    [safeRefetch, sidebarHeaderSelector],
  );

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await deleteHomeSidebarThread({
          id,
          selector: sidebarHeaderSelector,
        });
        await safeRefetch();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除对话失败，请稍后重试',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
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
      canEnableQuery ||
      !shouldEagerLoadHomeSidebarOnIntent({
        disabled,
        hasRuntimeScope,
        cachedThreadCount: getCachedHomeSidebarThreads(scopeKey).length,
      })
    ) {
      return;
    }

    void loadThreads();
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
