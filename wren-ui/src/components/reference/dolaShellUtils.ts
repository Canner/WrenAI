import type { ReactNode } from 'react';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';

export interface DolaShellNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  iconKey?: string;
  sectionLabel?: string;
  active?: boolean;
  badge?: ReactNode;
  placement?: 'top' | 'bottom';
  path?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  selector?: ClientRuntimeScopeSelector;
  navigationScope?: 'workspace' | 'runtime';
  onClick?: () => void;
}

export interface DolaShellHistoryItem {
  id: string;
  title: string;
  subtitle?: string;
  active?: boolean;
  selector?: ClientRuntimeScopeSelector;
  onClick?: () => void;
}

const SHELL_PREFETCH_PATHS = [
  Path.Home,
  Path.HomeDashboard,
  Path.Knowledge,
] as const;
const BACKGROUND_NAV_PREFETCH_KEYS = new Set(['dashboard']);
const BACKGROUND_HISTORY_PREFETCH_LIMIT = 1;

export type ShellUiState = {
  collapsed: boolean;
  historyScrollTop: number;
};

const DEFAULT_SHELL_UI_STATE: ShellUiState = {
  collapsed: false,
  historyScrollTop: 0,
};

const shellUiStateByScope = new Map<string, ShellUiState>();

export const resolveShellPrefetchUrls = (
  hrefBuilder: (path: string) => string,
) =>
  Array.from(
    new Set(
      SHELL_PREFETCH_PATHS.map((path) => hrefBuilder(path)).filter(Boolean),
    ),
  );

export const resolveShellUiScopeKey = ({
  workspaceId,
  runtimeScopeId,
}: {
  workspaceId?: string | null;
  runtimeScopeId?: string | null;
}) => workspaceId || runtimeScopeId || '__default__';

export const getCachedShellUiState = (scopeKey: string): ShellUiState =>
  shellUiStateByScope.get(scopeKey) || DEFAULT_SHELL_UI_STATE;

export const cacheShellUiState = (
  scopeKey: string,
  nextState: Partial<ShellUiState>,
) => {
  shellUiStateByScope.set(scopeKey, {
    ...getCachedShellUiState(scopeKey),
    ...nextState,
  });
};

export const resolveHistoryThreadNavigationSelector = ({
  item,
  fallbackSelector,
}: {
  item: DolaShellHistoryItem;
  fallbackSelector?: ClientRuntimeScopeSelector;
}) => item.selector || fallbackSelector || {};

export const resolveHistoryThreadHref = (
  hrefBuilder: (
    path: string,
    params?: Record<string, string | number | boolean | null | undefined>,
    selectorOverride?: ClientRuntimeScopeSelector,
  ) => string,
  threadId: string,
  selectorOverride?: ClientRuntimeScopeSelector,
) => hrefBuilder(`${Path.Home}/${threadId}`, {}, selectorOverride);

export const areRouteParamsEqual = (
  previous?: Record<
    string,
    string | number | boolean | null | undefined
  > | null,
  next?: Record<string, string | number | boolean | null | undefined> | null,
) => {
  if (previous === next) {
    return true;
  }

  const previousKeys = Object.keys(previous || {}).sort();
  const nextKeys = Object.keys(next || {}).sort();
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }

  return previousKeys.every(
    (key, index) =>
      key === nextKeys[index] && (previous || {})[key] === (next || {})[key],
  );
};

export const areSelectorsEqual = (
  previous?: ClientRuntimeScopeSelector | null,
  next?: ClientRuntimeScopeSelector | null,
) =>
  (previous?.workspaceId || null) === (next?.workspaceId || null) &&
  (previous?.knowledgeBaseId || null) === (next?.knowledgeBaseId || null) &&
  (previous?.kbSnapshotId || null) === (next?.kbSnapshotId || null) &&
  (previous?.deployHash || null) === (next?.deployHash || null) &&
  (previous?.runtimeScopeId || null) === (next?.runtimeScopeId || null);

export const hasShellNavIntent = (item: DolaShellNavItem) =>
  Boolean(item.path || item.onClick);

export const hasShellHistoryIntent = (item: DolaShellHistoryItem) =>
  Boolean(item.id || item.onClick);

export const shouldPrefetchShellIntent = ({
  active,
  hasAction,
}: {
  active?: boolean;
  hasAction: boolean;
}) => hasAction && !active;

export const resolveBackgroundNavPrefetchKeys = (
  navItems: DolaShellNavItem[],
  pathname?: string,
) =>
  ![Path.Home, Path.Thread].includes((pathname as Path) || Path.Home)
    ? []
    : navItems
        .filter(
          (item) =>
            shouldPrefetchShellIntent({
              active: item.active,
              hasAction: hasShellNavIntent(item),
            }) && BACKGROUND_NAV_PREFETCH_KEYS.has(item.key),
        )
        .map((item) => item.key);

export const resolveBackgroundHistoryPrefetchIds = (
  historyItems: DolaShellHistoryItem[],
  limit = BACKGROUND_HISTORY_PREFETCH_LIMIT,
) =>
  historyItems
    .filter((item) => !item.active)
    .map((item) => item.id)
    .filter(Boolean)
    .slice(0, limit);

export const areShellNavItemsEqual = (
  previous: DolaShellNavItem[],
  next: DolaShellNavItem[],
) =>
  previous.length === next.length &&
  previous.every((item, index) => {
    const nextItem = next[index];
    return (
      item.key === nextItem.key &&
      item.label === nextItem.label &&
      item.iconKey === nextItem.iconKey &&
      (item.iconKey ? true : item.icon === nextItem.icon) &&
      item.sectionLabel === nextItem.sectionLabel &&
      item.active === nextItem.active &&
      item.badge === nextItem.badge &&
      item.placement === nextItem.placement &&
      item.path === nextItem.path &&
      areRouteParamsEqual(item.params, nextItem.params) &&
      areSelectorsEqual(item.selector, nextItem.selector) &&
      item.navigationScope === nextItem.navigationScope &&
      item.onClick === nextItem.onClick
    );
  });

export const areShellHistoryItemsEqual = (
  previous: DolaShellHistoryItem[],
  next: DolaShellHistoryItem[],
) =>
  previous.length === next.length &&
  previous.every((item, index) => {
    const nextItem = next[index];
    return (
      item.id === nextItem.id &&
      item.title === nextItem.title &&
      item.subtitle === nextItem.subtitle &&
      item.active === nextItem.active &&
      areSelectorsEqual(item.selector, nextItem.selector) &&
      item.onClick === nextItem.onClick
    );
  });
