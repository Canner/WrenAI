import { ReactNode, memo } from 'react';
import { Divider } from 'antd';
import styled from 'styled-components';
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
  hideSidebarBranding?: boolean;
  hideSidebarFooterPanel?: boolean;
  hideSidebarCollapseToggle?: boolean;
  flushMainPadding?: boolean;
  flushBottomPadding?: boolean;
  stretchContent?: boolean;
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
  previous.hideSidebarBranding === next.hideSidebarBranding &&
  previous.hideSidebarFooterPanel === next.hideSidebarFooterPanel &&
  previous.hideSidebarCollapseToggle === next.hideSidebarCollapseToggle &&
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
  hideSidebarBranding = false,
  hideSidebarFooterPanel = false,
  hideSidebarCollapseToggle = false,
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
        hideBranding={hideSidebarBranding}
        hideCollapseToggle={hideSidebarCollapseToggle}
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

      {hideSidebarFooterPanel ? null : (
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
      )}
    </Sidebar>
  );
}, areDolaAppShellSidebarPropsEqual);

const ContentSlot = styled.div<{ $stretch?: boolean }>`
  display: ${(props) => (props.$stretch ? 'flex' : 'block')};
  flex-direction: column;
  flex: ${(props) => (props.$stretch ? '1 1 auto' : '0 0 auto')};
  height: ${(props) => (props.$stretch ? '100%' : 'auto')};
  min-height: ${(props) => (props.$stretch ? '0' : 'auto')};
`;

function DolaAppShellFrame({
  children,
  topbarExtra,
  flushMainPadding = false,
  flushBottomPadding = false,
  stretchContent = false,
  ...sidebarProps
}: Props) {
  return (
    <Shell>
      <DolaAppShellSidebar {...sidebarProps} />
      <Main $flush={flushMainPadding} $flushBottom={flushBottomPadding}>
        <MainInner>
          {topbarExtra ? <MainTopbar>{topbarExtra}</MainTopbar> : null}
          <ContentSlot $stretch={stretchContent}>{children}</ContentSlot>
        </MainInner>
      </Main>
    </Shell>
  );
}

export default function DolaAppShell(props: Props) {
  return <DolaAppShellFrame {...props} />;
}
