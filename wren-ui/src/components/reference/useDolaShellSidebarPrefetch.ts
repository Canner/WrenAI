import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { NextRouter } from 'next/router';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import {
  prefetchDashboardOverview,
  prefetchKnowledgeOverview,
  prefetchThreadOverview,
  prefetchWorkspaceOverview,
} from '@/utils/runtimePagePrefetch';
import {
  DolaShellHistoryItem,
  DolaShellNavItem,
  resolveBackgroundHistoryPrefetchIds,
  resolveBackgroundNavPrefetchKeys,
  resolveHistoryThreadHref,
  resolveHistoryThreadNavigationSelector,
  resolveShellPrefetchUrls,
} from './dolaShellUtils';

type Props = {
  navItems: DolaShellNavItem[];
  uniqueHistory: DolaShellHistoryItem[];
  historyItemById: Map<string, DolaShellHistoryItem>;
  scopeKey: string;
  hrefWorkspace: (path: string) => string;
  hrefRuntime: (
    path: string,
    params?: Record<string, string | number | boolean | null | undefined>,
    selectorOverride?: ClientRuntimeScopeSelector,
  ) => string;
  router: NextRouter;
  hasRuntimeScope: boolean;
  runtimeSelector: ClientRuntimeScopeSelector;
  workspaceScopedSelector: ClientRuntimeScopeSelector;
};

export default function useDolaShellSidebarPrefetch({
  navItems,
  uniqueHistory,
  historyItemById,
  scopeKey,
  hrefWorkspace,
  hrefRuntime,
  router,
  hasRuntimeScope,
  runtimeSelector,
  workspaceScopedSelector,
}: Props) {
  const prefetchedNavKeysRef = useRef<Set<string>>(new Set());
  const prefetchedThreadIdsRef = useRef<Set<number>>(new Set());
  const prefetchedRouteUrlsRef = useRef<Set<string>>(new Set());
  const prefetchUrls = useMemo(
    () => resolveShellPrefetchUrls((path) => hrefWorkspace(path)),
    [hrefWorkspace],
  );

  useEffect(() => {
    prefetchedNavKeysRef.current.clear();
    prefetchedThreadIdsRef.current.clear();
    prefetchedRouteUrlsRef.current.clear();
  }, [scopeKey]);

  const prefetchNavData = useCallback(
    (itemKey: string) => {
      if (!hasRuntimeScope) {
        return;
      }

      if (prefetchedNavKeysRef.current.has(itemKey)) {
        return;
      }
      prefetchedNavKeysRef.current.add(itemKey);

      if (itemKey === 'workspace') {
        void prefetchWorkspaceOverview(
          buildRuntimeScopeUrl(
            '/api/v1/workspace/current',
            {},
            workspaceScopedSelector,
          ),
        );
        return;
      }

      if (itemKey === 'dashboard') {
        void prefetchDashboardOverview({
          selector: workspaceScopedSelector,
        });
        return;
      }

      if (itemKey === 'knowledge') {
        void prefetchKnowledgeOverview({
          knowledgeBasesUrl: buildRuntimeScopeUrl(
            '/api/v1/knowledge/bases',
            {},
            workspaceScopedSelector,
          ),
          diagramUrl: buildRuntimeScopeUrl(
            '/api/v1/knowledge/diagram',
            {},
            runtimeSelector,
          ),
        });
      }
    },
    [hasRuntimeScope, runtimeSelector, workspaceScopedSelector],
  );

  const prefetchHistoryRoute = useCallback(
    (item: DolaShellHistoryItem) => {
      const historySelector = resolveHistoryThreadNavigationSelector({
        item,
        fallbackSelector: workspaceScopedSelector,
      });
      const threadId = item.id;

      if (typeof router.prefetch !== 'function') {
        const parsedThreadId = Number(threadId);
        if (
          Number.isFinite(parsedThreadId) &&
          !prefetchedThreadIdsRef.current.has(parsedThreadId)
        ) {
          prefetchedThreadIdsRef.current.add(parsedThreadId);
          void prefetchThreadOverview(parsedThreadId, {
            selector: historySelector,
          });
        }
        return;
      }

      const href = resolveHistoryThreadHref(
        hrefRuntime,
        threadId,
        historySelector,
      );
      if (!href) {
        return;
      }

      if (process.env.NODE_ENV !== 'development') {
        router.prefetch(href).catch(() => null);
      }

      const parsedThreadId = Number(threadId);
      if (
        Number.isFinite(parsedThreadId) &&
        !prefetchedThreadIdsRef.current.has(parsedThreadId)
      ) {
        prefetchedThreadIdsRef.current.add(parsedThreadId);
        void prefetchThreadOverview(parsedThreadId, {
          selector: historySelector,
        });
      }
    },
    [hrefRuntime, router, workspaceScopedSelector],
  );

  const backgroundPrefetchKeys = useMemo(
    () => resolveBackgroundNavPrefetchKeys(navItems, router.pathname),
    [navItems, router.pathname],
  );
  const backgroundHistoryPrefetchIds = useMemo(
    () => resolveBackgroundHistoryPrefetchIds(uniqueHistory),
    [uniqueHistory],
  );

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !hasRuntimeScope ||
      backgroundPrefetchKeys.length === 0
    ) {
      return;
    }

    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let idleHandle: number | null = null;

    const runPrefetch = () => {
      if (cancelled) {
        return;
      }

      backgroundPrefetchKeys.forEach((itemKey) => {
        prefetchNavData(itemKey);
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(runPrefetch, {
        timeout: 800,
      });
    } else {
      fallbackTimer = setTimeout(runPrefetch, 240);
    }

    return () => {
      cancelled = true;
      if (idleHandle != null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleHandle);
      }
      if (fallbackTimer != null) {
        clearTimeout(fallbackTimer);
      }
    };
  }, [backgroundPrefetchKeys, hasRuntimeScope, prefetchNavData]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      backgroundHistoryPrefetchIds.length === 0
    ) {
      return;
    }

    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let idleHandle: number | null = null;

    const runPrefetch = () => {
      if (cancelled) {
        return;
      }

      backgroundHistoryPrefetchIds.forEach((threadId) => {
        const historyItem = historyItemById.get(threadId);
        const historySelector = resolveHistoryThreadNavigationSelector({
          item: historyItem || { id: threadId, title: threadId },
          fallbackSelector: workspaceScopedSelector,
        });
        const parsedThreadId = Number(threadId);
        if (
          Number.isFinite(parsedThreadId) &&
          !prefetchedThreadIdsRef.current.has(parsedThreadId)
        ) {
          prefetchedThreadIdsRef.current.add(parsedThreadId);
          void prefetchThreadOverview(parsedThreadId, {
            selector: historySelector,
          });
        }
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(runPrefetch, {
        timeout: 800,
      });
    } else {
      fallbackTimer = setTimeout(runPrefetch, 240);
    }

    return () => {
      cancelled = true;
      if (idleHandle != null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleHandle);
      }
      if (fallbackTimer != null) {
        clearTimeout(fallbackTimer);
      }
    };
  }, [backgroundHistoryPrefetchIds, historyItemById, workspaceScopedSelector]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      (typeof router.prefetch !== 'function' &&
        process.env.NODE_ENV !== 'development')
    ) {
      return;
    }

    prefetchUrls.forEach((url) => {
      if (typeof router.prefetch === 'function') {
        router.prefetch(url).catch(() => null);
      }

      if (
        process.env.NODE_ENV === 'development' &&
        !prefetchedRouteUrlsRef.current.has(url)
      ) {
        prefetchedRouteUrlsRef.current.add(url);
        void fetch(url, {
          credentials: 'include',
        }).catch(() => null);
      }
    });
  }, [prefetchUrls, router]);

  return {
    prefetchNavData,
    prefetchHistoryRoute,
  };
}
