import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuProps } from 'antd';
import useAuthSession, { clearAuthSessionCache } from '@/hooks/useAuthSession';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';
import { clearUserConfigCache } from '@/utils/env';
import { clearRuntimePagePrefetchCache } from '@/utils/runtimePagePrefetch';
import {
  cacheShellUiState,
  DolaShellHistoryItem,
  DolaShellNavItem,
  getCachedShellUiState,
  hasShellNavIntent,
  resolveHistoryThreadNavigationSelector,
  resolveShellUiScopeKey,
  shouldPrefetchShellIntent,
} from './dolaShellUtils';
import useDolaShellSidebarPrefetch from './useDolaShellSidebarPrefetch';

const HISTORY_VIRTUALIZATION_THRESHOLD = 60;
const HISTORY_ITEM_ESTIMATED_HEIGHT = 48;
const HISTORY_VIRTUAL_OVERSCAN = 6;

export type UseDolaAppShellSidebarStateArgs = {
  navItems: DolaShellNavItem[];
  historyItems?: DolaShellHistoryItem[];
  onHistoryIntent?: () => void;
  onSettingsClick?: () => void;
};

export default function useDolaAppShellSidebarState({
  navItems,
  historyItems = [],
  onHistoryIntent,
  onSettingsClick,
}: UseDolaAppShellSidebarStateArgs) {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession({ includeWorkspaceQuery: false });
  const scopeKey = useMemo(
    () =>
      resolveShellUiScopeKey({
        workspaceId: runtimeScopeNavigation.selector.workspaceId,
        runtimeScopeId: runtimeScopeNavigation.selector.runtimeScopeId,
      }),
    [
      runtimeScopeNavigation.selector.runtimeScopeId,
      runtimeScopeNavigation.selector.workspaceId,
    ],
  );
  const historyScrollerRef = useRef<HTMLDivElement>(null);
  const [keyword, setKeyword] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [historyScrollTop, setHistoryScrollTop] = useState(0);
  const [historyViewportHeight, setHistoryViewportHeight] = useState(0);
  const [collapsed, setCollapsed] = useState(
    () => getCachedShellUiState(scopeKey).collapsed,
  );
  const hrefWorkspace =
    runtimeScopeNavigation.hrefWorkspace || runtimeScopeNavigation.href;
  const pushWorkspace =
    runtimeScopeNavigation.pushWorkspace || runtimeScopeNavigation.push;
  const pushRuntime = runtimeScopeNavigation.push;
  const workspaceScopedSelector = runtimeScopeNavigation.workspaceSelector;

  const uniqueHistory = useMemo(() => {
    const seen = new Set<string>();

    return historyItems.filter((item) => {
      const key = item.id.trim();
      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }, [historyItems]);

  const historyItemById = useMemo(
    () => new Map(uniqueHistory.map((item) => [item.id, item])),
    [uniqueHistory],
  );

  const filteredHistory = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) {
      return uniqueHistory;
    }

    return uniqueHistory.filter((item) => {
      const title = item.title?.toLowerCase?.() || '';
      const subtitle = item.subtitle?.toLowerCase?.() || '';
      return title.includes(query) || subtitle.includes(query);
    });
  }, [keyword, uniqueHistory]);

  const shouldVirtualizeHistory =
    filteredHistory.length >= HISTORY_VIRTUALIZATION_THRESHOLD;

  const historyVirtualWindow = useMemo(() => {
    if (!shouldVirtualizeHistory) {
      return {
        startIndex: 0,
        endIndex: filteredHistory.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const viewportHeight = Math.max(
      historyViewportHeight,
      HISTORY_ITEM_ESTIMATED_HEIGHT,
    );
    const visibleCount = Math.max(
      1,
      Math.ceil(viewportHeight / HISTORY_ITEM_ESTIMATED_HEIGHT),
    );
    const startIndex = Math.max(
      0,
      Math.floor(historyScrollTop / HISTORY_ITEM_ESTIMATED_HEIGHT) -
        HISTORY_VIRTUAL_OVERSCAN,
    );
    const endIndex = Math.min(
      filteredHistory.length,
      startIndex + visibleCount + HISTORY_VIRTUAL_OVERSCAN * 2,
    );

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * HISTORY_ITEM_ESTIMATED_HEIGHT,
      bottomSpacerHeight:
        (filteredHistory.length - endIndex) * HISTORY_ITEM_ESTIMATED_HEIGHT,
    };
  }, [
    filteredHistory.length,
    historyScrollTop,
    historyViewportHeight,
    shouldVirtualizeHistory,
  ]);

  const visibleHistoryItems = useMemo(
    () =>
      filteredHistory.slice(
        historyVirtualWindow.startIndex,
        historyVirtualWindow.endIndex,
      ),
    [
      filteredHistory,
      historyVirtualWindow.endIndex,
      historyVirtualWindow.startIndex,
    ],
  );

  const handleHistoryIntent = useCallback(() => {
    onHistoryIntent?.();
  }, [onHistoryIntent]);

  const handleNavItemSelect = useCallback(
    (item: DolaShellNavItem) => {
      if (item.path) {
        if (item.navigationScope === 'runtime') {
          void pushRuntime(
            item.path,
            item.params || {},
            item.selector || runtimeScopeNavigation.selector,
          );
          return;
        }

        void pushWorkspace(item.path, item.params || {});
        return;
      }

      item.onClick?.();
    },
    [pushRuntime, pushWorkspace, runtimeScopeNavigation.selector],
  );

  const handleHistoryItemSelect = useCallback(
    (item: DolaShellHistoryItem) => {
      if (item.onClick) {
        item.onClick();
        return;
      }

      const historySelector = resolveHistoryThreadNavigationSelector({
        item,
        fallbackSelector: workspaceScopedSelector,
      });

      void pushRuntime(`${Path.Home}/${item.id}`, {}, historySelector);
    },
    [pushRuntime, workspaceScopedSelector],
  );

  const accountDisplayName = useMemo(() => {
    const displayName = authSession.data?.user?.displayName?.trim();
    const email = authSession.data?.user?.email?.trim();
    return displayName || email || '未登录';
  }, [authSession.data?.user?.displayName, authSession.data?.user?.email]);

  const accountAvatar = useMemo(
    () => accountDisplayName.charAt(0).toUpperCase() || 'A',
    [accountDisplayName],
  );

  const selectedKeys = useMemo(
    () => navItems.filter((item) => item.active).map((item) => item.key),
    [navItems],
  );

  const topNavItems = useMemo(
    () => navItems.filter((item) => item.placement !== 'bottom'),
    [navItems],
  );
  const bottomNavItems = useMemo(
    () => navItems.filter((item) => item.placement === 'bottom'),
    [navItems],
  );

  const { prefetchNavData, prefetchHistoryRoute } = useDolaShellSidebarPrefetch(
    {
      navItems,
      uniqueHistory,
      historyItemById,
      scopeKey,
      hrefWorkspace,
      hrefRuntime: runtimeScopeNavigation.href,
      router,
      hasRuntimeScope: runtimeScopeNavigation.hasRuntimeScope,
      runtimeSelector: runtimeScopeNavigation.selector,
      workspaceScopedSelector,
    },
  );

  const buildMenuItems = useCallback(
    (items: DolaShellNavItem[]): NonNullable<MenuProps['items']> => {
      const leafItems = items.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: (
          <span onMouseMove={() => void prefetchNavData(item.key)}>
            {item.label}
            {item.badge || null}
          </span>
        ),
        onClick: () => {
          if (
            shouldPrefetchShellIntent({
              active: item.active,
              hasAction: hasShellNavIntent(item),
            })
          ) {
            void prefetchNavData(item.key);
          }
          handleNavItemSelect(item);
        },
      }));

      const hasSections = items.some((item) => item.sectionLabel);
      if (!hasSections) {
        return leafItems;
      }

      const groups = new Map<string, typeof leafItems>();
      const groupOrder: string[] = [];
      const ungrouped: typeof leafItems = [];

      leafItems.forEach((menuItem, index) => {
        const sectionLabel = items[index].sectionLabel;
        if (!sectionLabel) {
          ungrouped.push(menuItem);
          return;
        }
        if (!groups.has(sectionLabel)) {
          groups.set(sectionLabel, []);
          groupOrder.push(sectionLabel);
        }
        groups.get(sectionLabel)!.push(menuItem);
      });

      return [
        ...ungrouped,
        ...groupOrder.map((sectionLabel) => ({
          type: 'group' as const,
          key: `group-${sectionLabel}`,
          label: sectionLabel,
          children: groups.get(sectionLabel),
        })),
      ];
    },
    [handleNavItemSelect, prefetchNavData],
  );

  const menuItems = useMemo(
    () => buildMenuItems(topNavItems),
    [buildMenuItems, topNavItems],
  );
  const footerMenuItems = useMemo(
    () => buildMenuItems(bottomNavItems),
    [buildMenuItems, bottomNavItems],
  );

  const onLogout = useCallback(async () => {
    setLoggingOut(true);

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (_error) {
      // ignore network failures and still force auth re-entry
    } finally {
      setLoggingOut(false);
      clearAuthSessionCache();
      clearUserConfigCache();
      clearRuntimePagePrefetchCache();
      router.push(Path.Auth).catch(() => null);
    }
  }, [router.push]);

  const onAccountMenuClick = useCallback<NonNullable<MenuProps['onClick']>>(
    ({ key }) => {
      if (key === 'settings') {
        (onSettingsClick || (() => pushWorkspace(Path.Settings)))();
        return;
      }

      if (key === 'logout') {
        void onLogout();
      }
    },
    [onLogout, onSettingsClick, pushWorkspace],
  );

  useEffect(() => {
    setCollapsed(getCachedShellUiState(scopeKey).collapsed);
  }, [scopeKey]);

  useEffect(() => {
    cacheShellUiState(scopeKey, { collapsed });
  }, [collapsed, scopeKey]);

  useEffect(() => {
    const historyScroller = historyScrollerRef.current;
    if (!historyScroller || collapsed) {
      return;
    }

    const restoreScrollTop = () => {
      const nextScrollTop = getCachedShellUiState(scopeKey).historyScrollTop;
      historyScroller.scrollTop = nextScrollTop;
      setHistoryScrollTop(nextScrollTop);
    };

    restoreScrollTop();
    window.requestAnimationFrame(restoreScrollTop);

    return () => {
      cacheShellUiState(scopeKey, {
        historyScrollTop: historyScroller.scrollTop,
      });
    };
  }, [collapsed, filteredHistory.length, scopeKey]);

  useEffect(() => {
    const historyScroller = historyScrollerRef.current;
    if (!historyScroller || collapsed) {
      return;
    }

    const syncViewportHeight = () => {
      setHistoryViewportHeight(historyScroller.clientHeight);
    };
    syncViewportHeight();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        syncViewportHeight();
      });
      observer.observe(historyScroller);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', syncViewportHeight);
    return () => {
      window.removeEventListener('resize', syncViewportHeight);
    };
  }, [collapsed]);

  useEffect(() => {
    const historyScroller = historyScrollerRef.current;
    if (!historyScroller || collapsed) {
      return;
    }

    const handleScroll = () => {
      setHistoryScrollTop(historyScroller.scrollTop);
      cacheShellUiState(scopeKey, {
        historyScrollTop: historyScroller.scrollTop,
      });
    };

    historyScroller.addEventListener('scroll', handleScroll);
    return () => {
      historyScroller.removeEventListener('scroll', handleScroll);
    };
  }, [collapsed, scopeKey]);

  return {
    router,
    authSession,
    runtimeScopeNavigation,
    collapsed,
    setCollapsed,
    keyword,
    setKeyword,
    loggingOut,
    historyScrollerRef,
    filteredHistory,
    visibleHistoryItems,
    shouldVirtualizeHistory,
    topSpacerHeight: historyVirtualWindow.topSpacerHeight,
    bottomSpacerHeight: historyVirtualWindow.bottomSpacerHeight,
    handleHistoryIntent,
    handleHistoryItemSelect,
    accountDisplayName,
    accountAvatar,
    selectedKeys,
    menuItems,
    footerMenuItems,
    onAccountMenuClick,
    prefetchHistoryRoute,
  };
}
