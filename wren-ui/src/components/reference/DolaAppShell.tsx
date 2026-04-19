import { ReactNode, memo } from 'react';
import { Divider } from 'antd';
import DolaShellFooterPanel from './DolaShellFooterPanel';
import DolaShellHistoryPane from './DolaShellHistoryPane';
import DolaShellNavPane, { DolaShellBackAction } from './DolaShellNavPane';
import {
  areShellHistoryItemsEqual,
  areShellNavItemsEqual,
  DolaShellHistoryItem,
  DolaShellNavItem,
} from './dolaShellUtils';
import { Main, MainInner, MainTopbar, Shell, Sidebar } from './dolaShellStyles';
import useDolaAppShellSidebarState from './useDolaAppShellSidebarState';

export type { DolaShellBackAction } from './DolaShellNavPane';
export type { DolaShellHistoryItem, DolaShellNavItem } from './dolaShellUtils';
export {
  getCachedShellUiState,
  resolveBackgroundHistoryPrefetchIds,
  resolveBackgroundNavPrefetchKeys,
  resolveHistoryThreadHref,
  resolveHistoryThreadNavigationSelector,
  resolveShellPrefetchUrls,
  resolveShellUiScopeKey,
  shouldPrefetchShellIntent,
} from './dolaShellUtils';

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
  const {
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
    topSpacerHeight,
    bottomSpacerHeight,
    handleHistoryIntent,
    handleHistoryItemSelect,
    accountDisplayName,
    accountAvatar,
    selectedKeys,
    menuItems,
    footerMenuItems,
    onAccountMenuClick,
    prefetchHistoryRoute,
  } = useDolaAppShellSidebarState({
    navItems,
    historyItems,
    onHistoryIntent,
    onSettingsClick,
  });

  return (
    <Sidebar
      width={196}
      collapsed={collapsed}
      collapsedWidth={60}
      breakpoint="lg"
      trigger={null}
    >
      <DolaShellNavPane
        collapsed={collapsed}
        isHomeActive={router.pathname === '/home'}
        sidebarBackAction={sidebarBackAction}
        onPrimaryAction={onPrimaryAction}
        primaryActionLabel={primaryActionLabel}
        primaryActionIcon={primaryActionIcon}
        selectedKeys={selectedKeys}
        menuItems={menuItems}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
      />

      <Divider style={{ margin: 0 }} />

      {hideHistorySection ? (
        <div style={{ flex: 1 }} />
      ) : (
        <>
          <DolaShellHistoryPane
            collapsed={collapsed}
            historyLoading={historyLoading}
            historyTitle={historyTitle}
            historyEmptyText={historyEmptyText}
            searchPlaceholder={searchPlaceholder}
            keyword={keyword}
            onHistoryIntent={handleHistoryIntent}
            onKeywordChange={setKeyword}
            historyScrollerRef={historyScrollerRef}
            filteredHistory={filteredHistory}
            visibleHistoryItems={visibleHistoryItems}
            shouldVirtualizeHistory={shouldVirtualizeHistory}
            topSpacerHeight={topSpacerHeight}
            bottomSpacerHeight={bottomSpacerHeight}
            onHistoryPrefetch={prefetchHistoryRoute}
            onHistorySelect={handleHistoryItemSelect}
          />
          <Divider style={{ margin: 0 }} />
        </>
      )}

      <DolaShellFooterPanel
        collapsed={collapsed}
        selectedKeys={selectedKeys}
        footerMenuItems={footerMenuItems}
        hasRuntimeScope={runtimeScopeNavigation.hasRuntimeScope}
        onAccountMenuClick={onAccountMenuClick}
        loggingOut={loggingOut}
        authLoading={authSession.loading}
        accountAvatar={accountAvatar}
        accountDisplayName={accountDisplayName}
      />
    </Sidebar>
  );
}, areDolaAppShellSidebarPropsEqual);

function DolaAppShellFrame({ children, topbarExtra, ...sidebarProps }: Props) {
  return (
    <Shell>
      <DolaAppShellSidebar {...sidebarProps} />
      <Main>
        <MainInner>
          {topbarExtra ? <MainTopbar>{topbarExtra}</MainTopbar> : null}
          {children}
        </MainInner>
      </Main>
    </Shell>
  );
}

export default function DolaAppShell(props: Props) {
  return <DolaAppShellFrame {...props} />;
}
