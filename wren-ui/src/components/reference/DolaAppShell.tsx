import {
  Fragment,
  ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/router';
import {
  Button,
  Divider,
  Dropdown,
  Input,
  Layout,
  Menu,
  Space,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import LogoutOutlined from '@ant-design/icons/LogoutOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import MenuFoldOutlined from '@ant-design/icons/MenuFoldOutlined';
import MenuUnfoldOutlined from '@ant-design/icons/MenuUnfoldOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import ArrowLeftOutlined from '@ant-design/icons/ArrowLeftOutlined';
import styled from 'styled-components';
import useAuthSession, { clearAuthSessionCache } from '@/hooks/useAuthSession';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  ClientRuntimeScopeSelector,
  buildRuntimeScopeUrl,
} from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';
import { clearUserConfigCache } from '@/utils/env';
import {
  clearRuntimePagePrefetchCache,
  prefetchDashboardOverview,
  prefetchKnowledgeOverview,
  prefetchThreadOverview,
  prefetchWorkspaceOverview,
} from '@/utils/runtimePagePrefetch';
import { usePersistentShellEmbedded } from './PersistentShellContext';
import RuntimeScopeSelector from '@/components/runtimeScope/RuntimeScopeSelector';

const { Text } = Typography;
const { Sider, Content } = Layout;

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

export interface DolaShellBackAction {
  label: string;
  onClick: () => void;
}

interface Props {
  navItems: DolaShellNavItem[];
  historyItems?: DolaShellHistoryItem[];
  historyLoading?: boolean;
  onHistoryIntent?: () => void;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  primaryActionIcon?: ReactNode;
  sidebarMeta?: ReactNode;
  historyTitle?: string;
  historySecondaryTitle?: string;
  historyEmptyText?: string;
  searchPlaceholder?: string;
  topbarExtra?: ReactNode;
  onSettingsClick?: () => void;
  hideHistorySection?: boolean;
  sidebarBackAction?: DolaShellBackAction;
  children: ReactNode;
}

const SHELL_PREFETCH_PATHS = [
  Path.Home,
  Path.HomeDashboard,
  Path.Knowledge,
] as const;
const BACKGROUND_NAV_PREFETCH_KEYS = new Set(['dashboard']);
const BACKGROUND_HISTORY_PREFETCH_LIMIT = 1;
const HISTORY_VIRTUALIZATION_THRESHOLD = 60;
const HISTORY_ITEM_ESTIMATED_HEIGHT = 48;
const HISTORY_VIRTUAL_OVERSCAN = 6;

export const resolveShellPrefetchUrls = (
  hrefBuilder: (path: string) => string,
) =>
  Array.from(
    new Set(
      SHELL_PREFETCH_PATHS.map((path) => hrefBuilder(path)).filter(Boolean),
    ),
  );

type ShellUiState = {
  collapsed: boolean;
  historyScrollTop: number;
};

const DEFAULT_SHELL_UI_STATE: ShellUiState = {
  collapsed: false,
  historyScrollTop: 0,
};

const shellUiStateByScope = new Map<string, ShellUiState>();

export const resolveShellUiScopeKey = ({
  workspaceId,
  runtimeScopeId,
}: {
  workspaceId?: string | null;
  runtimeScopeId?: string | null;
}) => workspaceId || runtimeScopeId || '__default__';

export const getCachedShellUiState = (scopeKey: string): ShellUiState =>
  shellUiStateByScope.get(scopeKey) || DEFAULT_SHELL_UI_STATE;

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

const areRouteParamsEqual = (
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

const areSelectorsEqual = (
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

const areShellNavItemsEqual = (
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

const areShellHistoryItemsEqual = (
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

type SidebarProps = Omit<Props, 'children' | 'topbarExtra'>;

const areDolaAppShellSidebarPropsEqual = (
  previous: SidebarProps,
  next: SidebarProps,
) =>
  previous.historyLoading === next.historyLoading &&
  previous.onHistoryIntent === next.onHistoryIntent &&
  previous.onPrimaryAction === next.onPrimaryAction &&
  previous.primaryActionLabel === next.primaryActionLabel &&
  previous.primaryActionIcon === next.primaryActionIcon &&
  previous.sidebarMeta === next.sidebarMeta &&
  previous.historyTitle === next.historyTitle &&
  previous.historySecondaryTitle === next.historySecondaryTitle &&
  previous.historyEmptyText === next.historyEmptyText &&
  previous.searchPlaceholder === next.searchPlaceholder &&
  previous.onSettingsClick === next.onSettingsClick &&
  previous.hideHistorySection === next.hideHistorySection &&
  previous.sidebarBackAction?.label === next.sidebarBackAction?.label &&
  previous.sidebarBackAction?.onClick === next.sidebarBackAction?.onClick &&
  areShellNavItemsEqual(previous.navItems, next.navItems) &&
  areShellHistoryItemsEqual(
    previous.historyItems || [],
    next.historyItems || [],
  );

const cacheShellUiState = (
  scopeKey: string,
  nextState: Partial<ShellUiState>,
) => {
  shellUiStateByScope.set(scopeKey, {
    ...getCachedShellUiState(scopeKey),
    ...nextState,
  });
};

const Shell = styled(Layout)`
  min-height: 100vh;
  background: #ffffff;
`;

const Sidebar = styled(Sider)`
  && {
    position: sticky;
    top: 0;
    align-self: flex-start;
    height: 100vh;
    background: #ffffff;
    border-right: 1px solid #e5e7eb;
    padding: 10px 8px 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    .ant-layout-sider-children {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      gap: 12px;
    }

    .ant-menu {
      background: transparent;
      border: 0;
    }

    .ant-menu-inline > .ant-menu-item,
    .ant-menu-inline > .ant-menu-submenu > .ant-menu-submenu-title {
      width: 100%;
      height: 34px;
      line-height: 34px;
      margin: 0;
      padding-inline: 8px !important;
      border-radius: 10px;
      color: #4b5563;
      font-weight: 400;
      transition:
        background 0.18s ease,
        color 0.18s ease;
    }

    .ant-menu-inline > .ant-menu-item .ant-menu-title-content {
      min-width: 0;
    }

    .ant-menu-inline > .ant-menu-item:hover,
    .ant-menu-inline > .ant-menu-submenu > .ant-menu-submenu-title:hover {
      background: #f7f8fb;
      color: #111827;
    }

    .ant-menu-inline > .ant-menu-item-selected {
      background: #f3f4f6;
      color: #111827;
      box-shadow: inset 2px 0 0 #d6dbe3;
    }

    .ant-menu-inline-collapsed > .ant-menu-item,
    .ant-menu-inline-collapsed > .ant-menu-submenu > .ant-menu-submenu-title {
      padding-inline: calc(50% - 8px) !important;
    }

    .ant-menu-item-group {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #f1f3f7;
    }

    .ant-menu-item-group:first-of-type {
      margin-top: 2px;
      padding-top: 0;
      border-top: 0;
    }

    .ant-menu-item-group-title {
      padding: 3px 10px 5px !important;
      color: #8b93a7 !important;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .ant-menu-item-group-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .ant-menu-item-group-list .ant-menu-item,
    .ant-menu-item-group-list .ant-menu-submenu > .ant-menu-submenu-title {
      width: 100%;
      min-height: 30px;
      height: 30px;
      line-height: 30px;
      margin: 0;
      padding-inline: 8px !important;
      border-radius: 9px;
      color: #4b5563;
      font-size: 13px;
      font-weight: 400;
      transition:
        background 0.18s ease,
        color 0.18s ease;
    }

    .ant-menu-item-group-list .ant-menu-item .ant-menu-title-content,
    .ant-menu-item-group-list
      .ant-menu-submenu
      > .ant-menu-submenu-title
      .ant-menu-title-content {
      min-width: 0;
    }

    .ant-menu-item-group-list .ant-menu-item:hover,
    .ant-menu-item-group-list
      .ant-menu-submenu
      > .ant-menu-submenu-title:hover {
      background: #f7f8fb;
      color: #111827;
    }

    .ant-menu-item-group-list .ant-menu-item-selected {
      background: #f3f4f6;
      color: #111827;
      box-shadow: inset 2px 0 0 #d6dbe3;
    }

    .ant-menu-item-group-list .ant-menu-item .ant-menu-item-icon,
    .ant-menu-item-group-list
      .ant-menu-submenu
      > .ant-menu-submenu-title
      .ant-menu-item-icon {
      font-size: 13px;
    }

    &.ant-layout-sider-collapsed {
      padding: 10px 6px 0;
    }

    @media (max-width: 1120px) {
      position: static;
      align-self: stretch;
      height: auto;
      max-width: 100% !important;
      min-width: 100% !important;
      width: 100% !important;
      border-right: 0;
      border-bottom: 1px solid #e5e7eb;
    }
  }
`;

const BrandBlock = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: ${(props) =>
    props.$collapsed ? 'center' : 'space-between'};
  gap: 10px;
`;

const CollapseToggleButton = styled(Button)<{ $collapsed?: boolean }>`
  && {
    width: 30px;
    height: 30px;
    min-width: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    margin-inline: ${(props) => (props.$collapsed ? 'auto' : '0')};
    color: #4b5563;
  }
`;

const BrandIdentity = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
`;

const DotMatrix = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 6px);
  grid-template-rows: repeat(2, 6px);
  gap: 3px;
  margin-top: 4px;
  flex: 0 0 auto;

  span {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    display: block;
  }
`;

const BrandTitle = styled.div`
  font-size: 15px;
  line-height: 1.2;
  font-weight: 600;
  color: #111827;
`;

const NavSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
`;

const SidebarBackButton = styled(Button)<{ $collapsed?: boolean }>`
  && {
    height: 34px;
    border-radius: 10px;
    border: 1px solid #e5e7eb;
    color: #4b5563;
    background: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: ${(props) => (props.$collapsed ? 'center' : 'flex-start')};
    padding-inline: ${(props) => (props.$collapsed ? '0' : '10px')};

    &:hover,
    &:focus {
      color: #374151;
      border-color: #d7dbe4;
      background: #fafbfc;
    }
  }
`;

const FooterNavSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
`;

const FooterControlCluster = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: ${(props) => (props.$collapsed ? '0' : '8px')};
  border: ${(props) => (props.$collapsed ? '0' : '1px solid #f1f4f8')};
  border-radius: ${(props) => (props.$collapsed ? '0' : '14px')};
  background: ${(props) =>
    props.$collapsed
      ? 'transparent'
      : 'linear-gradient(180deg, #fcfdff 0%, #fafbfd 100%)'};
`;

const SidebarWorkspaceSwitcher = styled.div`
  flex-shrink: 0;
  min-height: 34px;
  min-width: 0;
  padding-top: 6px;
  border-top: 1px solid #f3f5f8;
  overflow: hidden;

  && {
    .runtime-scope-select.runtime-scope-workspace {
      width: 100%;
      min-width: 0;
    }

    .ant-select {
      width: 100%;
    }

    .ant-select-selector {
      height: 34px !important;
      border-radius: 10px !important;
      border-color: #edf1f5 !important;
      background: #f6f8fb !important;
      box-shadow: none !important;
      padding: 0 11px !important;
      transition:
        border-color 0.18s ease,
        background 0.18s ease !important;
    }

    .ant-select-selection-item {
      display: flex;
      align-items: center;
      font-size: 12px;
      color: #6b7280;
    }

    .ant-select:hover .ant-select-selector,
    .ant-select-focused .ant-select-selector {
      border-color: #e3e7ed !important;
      background: #ffffff !important;
    }

    .ant-select-arrow {
      color: #9ca3af;
    }
  }
`;

const SearchInput = styled(Input)`
  &&.ant-input,
  &&.ant-input-affix-wrapper {
    height: 24px;
    border-radius: 9px;
    border-color: transparent;
    background: #f7f8fb;
    box-shadow: none;
    padding-inline: 9px;
    color: #4b5563;
    font-size: 12px;
  }

  &&.ant-input-affix-wrapper .ant-input {
    height: auto;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  &&.ant-input::placeholder,
  &&.ant-input-affix-wrapper .ant-input::placeholder {
    color: #b9c1ce;
  }

  &&.ant-input:hover,
  &&.ant-input:focus,
  &&.ant-input-focused,
  &&.ant-input-affix-wrapper:hover,
  &&.ant-input-affix-wrapper:focus-within,
  &&.ant-input-affix-wrapper-focused {
    border-color: transparent;
    background: #f7f8fb;
    box-shadow: none;
  }
`;

const HistorySection = styled.div`
  min-height: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
`;

const HistoryScroller = styled.div`
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-right: 2px;
`;

const HistoryButton = styled(Button)<{ $active?: boolean }>`
  && {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    height: auto;
    width: 100%;
    min-height: 34px;
    padding: 3px 8px;
    border-radius: 8px;
    border: 0;
    background: ${(props) => (props.$active ? '#f7f8fb' : 'transparent')};
    color: #111827;
    text-align: left;
    transition:
      background 0.18s ease,
      color 0.18s ease;

    &:hover,
    &:focus {
      background: #f7f8fb;
      color: #111827;
    }

    > span {
      width: 100%;
      display: flex;
      justify-content: flex-start;
      text-align: left;
      min-width: 0;
    }

    > span > div {
      width: 100%;
      text-align: left;
      min-width: 0;
    }
  }
`;

const HistoryTextStack = styled.div`
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
`;

const HistoryPrimaryText = styled.div`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 400;
  color: #111827;
  line-height: 1.25;
`;

const HistorySecondaryText = styled.div`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #6b7280;
  line-height: 1.25;
`;

const Footer = styled.div`
  margin-top: auto;
  flex-shrink: 0;
  padding: 2px 0 10px;
`;

const AccountRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const AccountAvatar = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(123, 87, 232, 0.12);
  color: #6f4ce6;
  font-size: 13px;
  font-weight: 700;
  flex: 0 0 auto;
`;

const AccountButton = styled.button<{ $collapsed?: boolean }>`
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: ${(props) =>
    props.$collapsed ? 'center' : 'space-between'};
  gap: 10px;
  padding: ${(props) => (props.$collapsed ? '5px 0' : '6px 10px')};
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #ffffff;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;

  &:hover {
    border-color: #d7dbe4;
    background: #f7f8fb;
  }
`;

const Main = styled(Content)`
  min-width: 0;
  height: 100vh;
  overflow: auto;
  scrollbar-gutter: stable both-edges;
  background: #ffffff;
  padding: 24px 24px 24px 4px;

  @media (max-width: 1120px) {
    height: auto;
    padding: 16px;
  }
`;

const MainInner = styled.div`
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const MainTopbar = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  flex-wrap: wrap;
`;

const DolaAppShellSidebar = memo(function DolaAppShellSidebar({
  navItems,
  historyItems = [],
  historyLoading = false,
  onHistoryIntent,
  onPrimaryAction,
  primaryActionLabel = '新对话',
  primaryActionIcon,
  historyTitle = '历史对话',
  historyEmptyText = '暂无历史对话',
  searchPlaceholder = '搜索历史对话',
  onSettingsClick,
  hideHistorySection = false,
  sidebarBackAction,
}: SidebarProps) {
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
  const historyScrollerRef = useRef<HTMLDivElement | null>(null);
  const prefetchedNavKeysRef = useRef<Set<string>>(new Set());
  const prefetchedThreadIdsRef = useRef<Set<number>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [historyScrollTop, setHistoryScrollTop] = useState(0);
  const [historyViewportHeight, setHistoryViewportHeight] = useState(0);
  const [collapsed, setCollapsed] = useState(
    () => getCachedShellUiState(scopeKey).collapsed,
  );
  const hrefWorkspace =
    runtimeScopeNavigation.hrefWorkspace || runtimeScopeNavigation.href;
  const hrefRuntime = runtimeScopeNavigation.href;
  const pushWorkspace =
    runtimeScopeNavigation.pushWorkspace || runtimeScopeNavigation.push;
  const pushRuntime = runtimeScopeNavigation.push;
  const workspaceScopedSelector = runtimeScopeNavigation.workspaceSelector;
  const prefetchUrls = useMemo(
    () => resolveShellPrefetchUrls((path) => hrefWorkspace(path)),
    [hrefWorkspace],
  );

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

      void pushRuntime(
        `${Path.Home}/${item.id}`,
        {},
        historySelector,
      );
    },
    [pushRuntime, workspaceScopedSelector],
  );

  useEffect(() => {
    prefetchedNavKeysRef.current.clear();
    prefetchedThreadIdsRef.current.clear();
  }, [scopeKey]);

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

  const prefetchNavData = useCallback(
    (itemKey: string) => {
      if (!runtimeScopeNavigation.hasRuntimeScope) {
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
            runtimeScopeNavigation.selector,
          ),
        });
      }
    },
    [
      runtimeScopeNavigation.hasRuntimeScope,
      runtimeScopeNavigation.selector,
      workspaceScopedSelector,
    ],
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
      !runtimeScopeNavigation.hasRuntimeScope ||
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
  }, [
    backgroundPrefetchKeys,
    prefetchNavData,
    runtimeScopeNavigation.hasRuntimeScope,
  ]);

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

  const buildMenuItems = (
    items: DolaShellNavItem[],
  ): NonNullable<MenuProps['items']> => {
    const leafItems = items.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: (
        <Space
          size={8}
          style={{ width: '100%', justifyContent: 'space-between' }}
          onMouseMove={() => prefetchNavData(item.key)}
        >
          <span>{item.label}</span>
          {item.badge || null}
        </Space>
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
  };

  const menuItems = useMemo(
    () => buildMenuItems(topNavItems),
    [topNavItems, prefetchNavData, handleNavItemSelect],
  );
  const footerMenuItems = useMemo(
    () => buildMenuItems(bottomNavItems),
    [bottomNavItems, prefetchNavData, handleNavItemSelect],
  );

  const onLogout = async () => {
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
  };

  const onAccountMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'settings') {
      (onSettingsClick || (() => pushWorkspace(Path.Settings)))();
      return;
    }

    if (key === 'logout') {
      void onLogout();
    }
  };

  useEffect(() => {
    if (typeof router.prefetch !== 'function') {
      return;
    }

    prefetchUrls.forEach((url) => {
      router.prefetch(url).catch(() => null);
    });
  }, [prefetchUrls, router]);

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

  return (
    <Sidebar
      width={196}
      collapsed={collapsed}
      collapsedWidth={60}
      breakpoint="lg"
      trigger={null}
    >
      <BrandBlock $collapsed={collapsed}>
        {!collapsed ? (
          <BrandIdentity>
            <DotMatrix aria-hidden>
              <span style={{ background: '#7757e8' }} />
              <span style={{ background: '#4f83ff' }} />
              <span style={{ background: '#f0b429' }} />
              <span style={{ background: '#ef6b5b' }} />
            </DotMatrix>
            <div>
              <BrandTitle>Nova</BrandTitle>
            </div>
          </BrandIdentity>
        ) : null}
        <CollapseToggleButton
          type="text"
          size="small"
          $collapsed={collapsed}
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          onClick={() => setCollapsed((value) => !value)}
        />
      </BrandBlock>

      <NavSection>
        {sidebarBackAction ? (
          <SidebarBackButton
            type="text"
            size="small"
            block={!collapsed}
            $collapsed={collapsed}
            icon={<ArrowLeftOutlined />}
            aria-label={sidebarBackAction.label}
            onClick={sidebarBackAction.onClick}
          >
            {collapsed ? null : sidebarBackAction.label}
          </SidebarBackButton>
        ) : null}

        {onPrimaryAction ? (
          <Button
            type={router.pathname === Path.Home ? 'primary' : 'default'}
            size="large"
            block
            icon={primaryActionIcon}
            onClick={onPrimaryAction}
          >
            {collapsed ? null : primaryActionLabel}
          </Button>
        ) : null}

        <Menu mode="inline" selectedKeys={selectedKeys} items={menuItems} />
      </NavSection>

      <Divider style={{ margin: 0 }} />

      {hideHistorySection ? (
        <div style={{ flex: 1 }} />
      ) : (
        <>
          {!collapsed ? (
            <HistorySection onPointerDown={handleHistoryIntent}>
              <div>
                <Text
                  strong
                  style={{ display: 'block', fontSize: 13, color: '#111827' }}
                >
                  {historyTitle}
                </Text>
              </div>

              <SearchInput
                placeholder={searchPlaceholder}
                value={keyword}
                onFocus={handleHistoryIntent}
                onChange={(event) => {
                  handleHistoryIntent();
                  setKeyword(event.target.value);
                }}
              />

              <HistoryScroller
                ref={historyScrollerRef}
                data-testid="shell-history-scroller"
              >
                {filteredHistory.length === 0 && historyLoading ? (
                  <Text
                    type="secondary"
                    style={{ fontSize: 13, padding: '8px 4px' }}
                  >
                    加载历史对话中...
                  </Text>
                ) : filteredHistory.length === 0 ? (
                  <Text
                    type="secondary"
                    style={{ fontSize: 13, padding: '8px 4px' }}
                  >
                    {historyEmptyText}
                  </Text>
                ) : (
                  <>
                    {shouldVirtualizeHistory &&
                    historyVirtualWindow.topSpacerHeight > 0 ? (
                      <div
                        style={{
                          height: historyVirtualWindow.topSpacerHeight,
                        }}
                        aria-hidden
                      />
                    ) : null}
                    {visibleHistoryItems.map((item) => (
                      <HistoryButton
                        key={item.id}
                        type="text"
                        block
                        $active={item.active}
                        onMouseEnter={() => prefetchHistoryRoute(item)}
                        onFocus={() => prefetchHistoryRoute(item)}
                        onClick={() => {
                          if (
                            shouldPrefetchShellIntent({
                              active: item.active,
                              hasAction: hasShellHistoryIntent(item),
                            })
                          ) {
                            void prefetchHistoryRoute(item);
                          }
                          handleHistoryItemSelect(item);
                        }}
                      >
                        <HistoryTextStack>
                          <HistoryPrimaryText title={item.title}>
                            {item.title}
                          </HistoryPrimaryText>
                          {item.subtitle ? (
                            <HistorySecondaryText title={item.subtitle}>
                              {item.subtitle}
                            </HistorySecondaryText>
                          ) : null}
                        </HistoryTextStack>
                      </HistoryButton>
                    ))}
                    {shouldVirtualizeHistory &&
                    historyVirtualWindow.bottomSpacerHeight > 0 ? (
                      <div
                        style={{
                          height: historyVirtualWindow.bottomSpacerHeight,
                        }}
                        aria-hidden
                      />
                    ) : null}
                  </>
                )}
              </HistoryScroller>
            </HistorySection>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          <Divider style={{ margin: 0 }} />
        </>
      )}

      <Footer>
        <FooterControlCluster $collapsed={collapsed}>
          {footerMenuItems.length > 0 ? (
            <FooterNavSection>
              <Menu
                mode="inline"
                selectedKeys={selectedKeys}
                items={footerMenuItems}
              />
            </FooterNavSection>
          ) : null}
          {!collapsed && runtimeScopeNavigation.hasRuntimeScope ? (
            <SidebarWorkspaceSwitcher data-testid="shell-workspace-switcher">
              <RuntimeScopeSelector
                layout="stacked"
                size="small"
                scope="workspace"
              />
            </SidebarWorkspaceSwitcher>
          ) : null}

          <Dropdown
            overlay={
              <Menu onClick={onAccountMenuClick}>
                <Menu.Item key="settings" icon={<SettingOutlined />}>
                  系统设置
                </Menu.Item>
                <Menu.Item key="logout" icon={<LogoutOutlined />}>
                  {loggingOut ? '退出中…' : '退出登录'}
                </Menu.Item>
              </Menu>
            }
            trigger={['click']}
            placement="topLeft"
          >
            <AccountButton
              type="button"
              $collapsed={collapsed}
              aria-label="账户菜单"
            >
              <AccountRow>
                <AccountAvatar>
                  {authSession.loading ? <UserOutlined /> : accountAvatar}
                </AccountAvatar>
                {!collapsed ? (
                  <div style={{ minWidth: 0 }}>
                    <Text
                      strong
                      style={{
                        display: 'block',
                        fontSize: 13,
                        color: '#111827',
                      }}
                      ellipsis
                    >
                      {authSession.loading
                        ? '正在验证身份…'
                        : accountDisplayName}
                    </Text>
                  </div>
                ) : null}
              </AccountRow>
              {!collapsed ? (
                <DownOutlined style={{ color: '#9ca3af', fontSize: 12 }} />
              ) : null}
            </AccountButton>
          </Dropdown>
        </FooterControlCluster>
      </Footer>
    </Sidebar>
  );
}, areDolaAppShellSidebarPropsEqual);

function DolaAppShellFrame({ children, topbarExtra, ...sidebarProps }: Props) {
  const resolvedTopbarExtra = useMemo(() => {
    const extras: ReactNode[] = [];

    if (topbarExtra) {
      extras.push(<Fragment key="topbar-extra">{topbarExtra}</Fragment>);
    }

    if (extras.length === 0) {
      return null;
    }

    return extras;
  }, [topbarExtra]);

  return (
    <Shell>
      <DolaAppShellSidebar {...sidebarProps} />
      <Main>
        <MainInner>
          {resolvedTopbarExtra ? (
            <MainTopbar>{resolvedTopbarExtra}</MainTopbar>
          ) : null}
          {children}
        </MainInner>
      </Main>
    </Shell>
  );
}

export default function DolaAppShell(props: Props) {
  const embedded = usePersistentShellEmbedded();

  if (embedded) {
    return <>{props.children}</>;
  }

  return <DolaAppShellFrame {...props} />;
}
