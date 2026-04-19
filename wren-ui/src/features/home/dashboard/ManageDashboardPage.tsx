import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { message } from 'antd';

import { LoadingWrapper } from '@/components/PageLoading';
import type { DashboardGridHandle } from '@/components/pages/home/dashboardGrid';
import type { Schedule } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import useDrawerAction from '@/hooks/useDrawerAction';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { hasExecutableRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';
import { isHistoricalSnapshotReadonly } from '@/utils/runtimeSnapshot';
import {
  resolveSettingsConnection,
  type SettingsData,
} from '@/utils/settingsRest';

import { DashboardCreateModal } from './DashboardCreateModal';
import { DashboardWorkbenchRail } from './DashboardWorkbenchRail';
import { DashboardWorkbenchStage } from './DashboardWorkbenchStage';
import { DashboardWorkbench } from './manageDashboardPageStyles';
import {
  isSupportCachedSettings,
  useDashboardDetailData,
  useDashboardListData,
} from './useManageDashboardData';
import { useManageDashboardPageActions } from './useManageDashboardPageActions';

export default function Dashboard() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const dashboardGridRef = useRef<DashboardGridHandle>(null);
  const cacheSettingsDrawer = useDrawerAction();
  const [cardKeyword, setCardKeyword] = useState('');
  const [dashboardKeyword, setDashboardKeyword] = useState('');
  const [selectedDashboardItemId, setSelectedDashboardItemId] = useState<
    number | null
  >(null);
  const [createDashboardOpen, setCreateDashboardOpen] = useState(false);
  const [createDashboardName, setCreateDashboardName] = useState('');
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const runtimeSelectorState = useRuntimeSelectorState().runtimeSelectorState;

  const isDashboardReadonly = isHistoricalSnapshotReadonly({
    selectorHasRuntime: Boolean(
      runtimeScopeNavigation.selector.deployHash ||
        runtimeScopeNavigation.selector.kbSnapshotId ||
        runtimeScopeNavigation.selector.runtimeScopeId,
    ),
    currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
    defaultKbSnapshotId:
      runtimeSelectorState?.currentKnowledgeBase?.defaultKbSnapshotId,
  });

  const resolvedCacheSupport = useMemo(() => {
    const connection = resolveSettingsConnection(settings);
    return connection ? isSupportCachedSettings(connection) : null;
  }, [settings]);

  const {
    data: visibleDashboards,
    loading: dashboardsLoading,
    refetch: refetchDashboards,
  } = useDashboardListData({
    enabled: runtimeScopePage.hasRuntimeScope,
    selector: runtimeScopeNavigation.selector,
    onError: () => {
      message.error('加载看板列表失败。');
      runtimeScopeNavigation.pushWorkspace(Path.Home);
    },
  });

  const requestedDashboardId = useMemo(() => {
    const rawDashboardId = router.query.dashboardId;
    const value = Array.isArray(rawDashboardId)
      ? rawDashboardId[0]
      : rawDashboardId;
    if (typeof value !== 'string' || value.trim() === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }, [router.query.dashboardId]);

  const activeDashboardId = useMemo(() => {
    if (
      requestedDashboardId != null &&
      visibleDashboards.some(
        (dashboard) => dashboard.id === requestedDashboardId,
      )
    ) {
      return requestedDashboardId;
    }

    return visibleDashboards[0]?.id ?? null;
  }, [requestedDashboardId, visibleDashboards]);

  const activeDashboard = useMemo(
    () =>
      visibleDashboards.find(
        (dashboard) => dashboard.id === activeDashboardId,
      ) || null,
    [activeDashboardId, visibleDashboards],
  );

  const replaceDashboardRoute = useCallback(
    async (dashboardId: number) => {
      const normalizedUrl = runtimeScopeNavigation.hrefWorkspace(
        Path.HomeDashboard,
        { dashboardId },
      );

      if (!normalizedUrl || normalizedUrl === router.asPath) {
        return;
      }

      await router.replace(normalizedUrl, undefined, {
        scroll: false,
        shallow: true,
      });
    },
    [router, runtimeScopeNavigation.hrefWorkspace],
  );

  const filteredDashboards = useMemo(() => {
    const normalizedKeyword = dashboardKeyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return visibleDashboards;
    }

    return visibleDashboards.filter((dashboard) =>
      `${dashboard.name} ${dashboard.scheduleFrequency || ''}`
        .toLowerCase()
        .includes(normalizedKeyword),
    );
  }, [dashboardKeyword, visibleDashboards]);

  useEffect(() => {
    if (
      !router.isReady ||
      !runtimeScopePage.hasRuntimeScope ||
      activeDashboardId == null ||
      requestedDashboardId === activeDashboardId
    ) {
      return;
    }

    void replaceDashboardRoute(activeDashboardId);
  }, [
    activeDashboardId,
    requestedDashboardId,
    router.isReady,
    replaceDashboardRoute,
    runtimeScopePage.hasRuntimeScope,
  ]);

  useEffect(() => {
    setSelectedDashboardItemId(null);
  }, [activeDashboardId]);

  const {
    data: visibleDashboardDetail,
    loading: dashboardLoading,
    refetch: refetchDashboard,
    updateData: updateDashboardDetailData,
  } = useDashboardDetailData({
    enabled: runtimeScopePage.hasRuntimeScope,
    dashboardId: activeDashboardId,
    selector: runtimeScopeNavigation.selector,
    onError: () => {
      message.error('加载看板项失败。');
      runtimeScopeNavigation.pushWorkspace(Path.Home);
    },
  });

  const loading =
    (dashboardsLoading && visibleDashboards.length === 0) ||
    (dashboardLoading && activeDashboardId != null && !visibleDashboardDetail);
  const dashboardItems = useMemo(
    () => visibleDashboardDetail?.items || [],
    [visibleDashboardDetail?.items],
  );
  const dashboardCacheEnabled = Boolean(
    visibleDashboardDetail?.cacheEnabled || activeDashboard?.cacheEnabled,
  );
  const hasExecutableDashboardRuntime = hasExecutableRuntimeScopeSelector(
    runtimeScopeNavigation.selector,
  );
  const isSupportCached =
    dashboardCacheEnabled || resolvedCacheSupport === true;
  const canShowCacheSettings =
    dashboardCacheEnabled || resolvedCacheSupport !== false;

  const dashboardSummaryItems = useMemo(
    () =>
      dashboardItems.map((item, index) => ({
        id: item.id,
        title: item.displayName || `图表卡片 ${index + 1}`,
        meta: `${item.type} · ${item.layout.w}×${item.layout.h}`,
      })),
    [dashboardItems],
  );

  const filteredDashboardSummaryItems = useMemo(() => {
    const normalizedKeyword = cardKeyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return dashboardSummaryItems;
    }

    return dashboardSummaryItems.filter((item) =>
      `${item.title} ${item.meta}`.toLowerCase().includes(normalizedKeyword),
    );
  }, [cardKeyword, dashboardSummaryItems]);

  const selectedDashboardItem = useMemo(() => {
    const selectedFromState = dashboardItems.find(
      (item) => item.id === selectedDashboardItemId,
    );
    return selectedFromState || dashboardItems[0] || null;
  }, [dashboardItems, selectedDashboardItemId]);

  const {
    createDashboardLoading,
    goToSourceThread,
    onDashboardItemUpdated,
    onDelete,
    onUpdateChange,
    openCacheSettings,
    refreshActiveDashboard,
    submitCacheSettings,
    submitCreateDashboard,
  } = useManageDashboardPageActions({
    activeDashboardId,
    cacheSettingsDrawer,
    createDashboardName,
    dashboardCacheEnabled,
    hasExecutableDashboardRuntime,
    isDashboardReadonly,
    refetchDashboard,
    refetchDashboards,
    replaceDashboardRoute,
    resolvedCacheSupport,
    runtimeScopeNavigation,
    runtimeScopePageHasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    selectedDashboardItemId,
    setCreateDashboardName,
    setCreateDashboardOpen,
    setSelectedDashboardItemId,
    setSettings,
    updateDashboardDetailData,
    visibleDashboardDetailCacheEnabled: visibleDashboardDetail?.cacheEnabled,
    visibleDashboardDetailSchedule: visibleDashboardDetail?.schedule,
  });

  const onSelectItem = (itemId: number) => {
    setSelectedDashboardItemId(itemId);
    dashboardGridRef.current?.focusItem(itemId);
  };

  if (runtimeScopePage.guarding) {
    return (
      <ConsoleShellLayout
        activeNav="dashboard"
        title="数据看板"
        hideHeader
        contentBorderless
        loading
      />
    );
  }

  return (
    <ConsoleShellLayout
      activeNav="dashboard"
      title="数据看板"
      hideHeader
      contentBorderless
    >
      <LoadingWrapper loading={loading}>
        <DashboardWorkbench>
          <DashboardWorkbenchRail
            activeDashboardId={activeDashboardId}
            cardKeyword={cardKeyword}
            dashboardKeyword={dashboardKeyword}
            dashboards={filteredDashboards}
            filteredDashboardSummaryItems={filteredDashboardSummaryItems}
            isDashboardReadonly={isDashboardReadonly}
            onCardKeywordChange={setCardKeyword}
            onCreateDashboard={() => setCreateDashboardOpen(true)}
            onDashboardKeywordChange={setDashboardKeyword}
            onDeleteSelectedItem={() =>
              selectedDashboardItem
                ? void onDelete(selectedDashboardItem.id)
                : undefined
            }
            onFocusSelectedItem={() => {
              if (selectedDashboardItem) {
                dashboardGridRef.current?.focusItem(selectedDashboardItem.id);
              }
            }}
            onGoToSourceThread={() =>
              void goToSourceThread(
                selectedDashboardItem?.detail?.sourceThreadId,
                selectedDashboardItem?.detail?.sourceResponseId,
              )
            }
            onSelectDashboard={(dashboardId) => {
              void replaceDashboardRoute(dashboardId);
            }}
            onSelectItem={onSelectItem}
            selectedDashboardItem={selectedDashboardItem}
          />

          <DashboardWorkbenchStage
            activeDashboardName={
              visibleDashboardDetail?.name ||
              activeDashboard?.name ||
              '默认看板'
            }
            cacheSettingsDrawerProps={{
              ...cacheSettingsDrawer.state,
              onClose: cacheSettingsDrawer.closeDrawer,
            }}
            canShowCacheSettings={canShowCacheSettings}
            dashboardCacheEnabled={dashboardCacheEnabled}
            dashboardGridRef={dashboardGridRef}
            dashboardItems={dashboardItems}
            isDashboardReadonly={isDashboardReadonly}
            isSupportCached={isSupportCached}
            nextScheduleTime={visibleDashboardDetail?.nextScheduledAt}
            onCacheSettings={openCacheSettings}
            onCreateChart={() =>
              runtimeScopeNavigation.pushWorkspace(Path.Home)
            }
            onDeleteItem={onDelete}
            onGoToThread={goToSourceThread}
            onItemUpdated={onDashboardItemUpdated}
            onRefreshAll={() => {
              dashboardGridRef.current?.onRefreshAll();
            }}
            onRefreshDashboard={refreshActiveDashboard}
            onSubmitCacheSettings={submitCacheSettings}
            onUpdateChange={onUpdateChange as (layouts: any[]) => Promise<void>}
            readOnlySchedule={visibleDashboardDetail?.schedule as Schedule}
            runtimeScopeSelector={runtimeScopeNavigation.selector}
          />
        </DashboardWorkbench>
      </LoadingWrapper>
      <DashboardCreateModal
        createDashboardLoading={createDashboardLoading}
        createDashboardName={createDashboardName}
        isDashboardReadonly={isDashboardReadonly}
        open={createDashboardOpen}
        onCancel={() => setCreateDashboardOpen(false)}
        onChangeName={setCreateDashboardName}
        onSubmit={submitCreateDashboard}
      />
    </ConsoleShellLayout>
  );
}
