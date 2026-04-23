import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';

import { appMessage as message, appModal } from '@/utils/antdAppBridge';
import { LoadingWrapper } from '@/components/PageLoading';
import type { DashboardGridHandle } from '@/components/pages/home/dashboardGrid';
import type { Schedule } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import DirectShellPageFrame from '@/components/reference/DirectShellPageFrame';
import useDrawerAction from '@/hooks/useDrawerAction';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import {
  hasExecutableRuntimeScopeSelector,
  resolveHydratedRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';
import { isHistoricalSnapshotReadonly } from '@/utils/runtimeSnapshot';
import { resolveDashboardDisplayName } from '@/utils/dashboardRest';
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
import { resolveDashboardBoundSelector } from './dashboardRuntimeSelectors';

export default function Dashboard() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const dashboardGridRef = useRef<DashboardGridHandle>(null);
  const cacheSettingsDrawer = useDrawerAction();
  const [selectedDashboardItemId, setSelectedDashboardItemId] = useState<
    number | null
  >(null);
  const [createDashboardOpen, setCreateDashboardOpen] = useState(false);
  const [createDashboardName, setCreateDashboardName] = useState('');
  const [renameDashboardOpen, setRenameDashboardOpen] = useState(false);
  const [renameDashboardId, setRenameDashboardId] = useState<number | null>(
    null,
  );
  const [renameDashboardName, setRenameDashboardName] = useState('');
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const runtimeSelectorState = useRuntimeSelectorState().runtimeSelectorState;
  const currentDashboardRuntimeSelector = useMemo(
    () =>
      resolveHydratedRuntimeScopeSelector({
        selector: runtimeScopeNavigation.selector,
        selectorState: runtimeSelectorState,
      }),
    [runtimeScopeNavigation.selector, runtimeSelectorState],
  );
  const dashboardPageSelector = runtimeScopeNavigation.workspaceSelector;

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
    selector: dashboardPageSelector,
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
      const normalizedUrl = runtimeScopeNavigation.href(
        Path.HomeDashboard,
        { dashboardId },
        dashboardPageSelector,
      );

      if (!normalizedUrl || normalizedUrl === router.asPath) {
        return;
      }

      await router.replace(normalizedUrl, undefined, {
        scroll: false,
        shallow: true,
      });
    },
    [dashboardPageSelector, router, runtimeScopeNavigation.href],
  );

  useEffect(() => {
    if (
      !router.isReady ||
      !runtimeScopePage.hasRuntimeScope ||
      activeDashboardId == null
    ) {
      return;
    }

    void replaceDashboardRoute(activeDashboardId);
  }, [
    activeDashboardId,
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
    selector: dashboardPageSelector,
    onError: () => {
      message.error('加载看板项失败。');
      runtimeScopeNavigation.pushWorkspace(Path.Home);
    },
  });

  const activeDashboardRuntimeSelector = useMemo(
    () =>
      resolveDashboardBoundSelector({
        workspaceSelector: dashboardPageSelector,
        dashboard: visibleDashboardDetail || activeDashboard,
        fallbackSelector: currentDashboardRuntimeSelector,
      }),
    [
      activeDashboard,
      currentDashboardRuntimeSelector,
      dashboardPageSelector,
      visibleDashboardDetail,
    ],
  );
  const resolveDashboardSelector = useCallback(
    (dashboardId?: number | null) =>
      resolveDashboardBoundSelector({
        workspaceSelector: dashboardPageSelector,
        dashboard:
          dashboardId != null && dashboardId === activeDashboardId
            ? visibleDashboardDetail || activeDashboard
            : visibleDashboards.find(
                (dashboard) => dashboard.id === dashboardId,
              ) || null,
        fallbackSelector: currentDashboardRuntimeSelector,
      }),
    [
      activeDashboard,
      activeDashboardId,
      currentDashboardRuntimeSelector,
      dashboardPageSelector,
      visibleDashboardDetail,
      visibleDashboards,
    ],
  );
  const isDashboardReadonly = isHistoricalSnapshotReadonly({
    selectorHasRuntime: Boolean(
      activeDashboardRuntimeSelector.deployHash ||
      activeDashboardRuntimeSelector.kbSnapshotId ||
      activeDashboardRuntimeSelector.runtimeScopeId,
    ),
    currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
    defaultKbSnapshotId:
      runtimeSelectorState?.currentKnowledgeBase?.defaultKbSnapshotId,
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
    activeDashboardRuntimeSelector,
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

  const selectedDashboardItem = useMemo(() => {
    const selectedFromState = dashboardItems.find(
      (item) => item.id === selectedDashboardItemId,
    );
    return selectedFromState || dashboardItems[0] || null;
  }, [dashboardItems, selectedDashboardItemId]);

  const {
    cacheSettingsSubmitting,
    createDashboardLoading,
    dashboardMutationTargetId,
    dashboardMutationType,
    goToSourceThread,
    onDashboardItemUpdated,
    onDelete,
    onUpdateChange,
    openCacheSettings,
    refreshDashboard,
    submitCacheSettings,
    submitCreateDashboard,
    submitDeleteDashboard,
    submitRenameDashboard,
    submitSetDefaultDashboard,
  } = useManageDashboardPageActions({
    activeDashboardId,
    cacheSettingsDrawer,
    createDashboardName,
    dashboardCacheEnabled,
    dashboardCreateSelector: dashboardPageSelector,
    resolveDashboardSelector,
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

  const onOpenRenameDashboard = useCallback(
    (dashboardId: number) => {
      const targetDashboard = visibleDashboards.find(
        (dashboard) => dashboard.id === dashboardId,
      );
      if (!targetDashboard) {
        return;
      }
      setRenameDashboardId(dashboardId);
      setRenameDashboardName(targetDashboard.name);
      setRenameDashboardOpen(true);
    },
    [visibleDashboards],
  );

  const onDeleteDashboard = useCallback(
    (dashboardId: number) => {
      const targetDashboard = visibleDashboards.find(
        (dashboard) => dashboard.id === dashboardId,
      );
      appModal.confirm({
        title: '确认删除这个看板吗？',
        content: `删除后将移除「${resolveDashboardDisplayName(
          targetDashboard?.name,
        )}」以及其中的图表。若它是默认看板，系统会自动补一个默认看板。`,
        okText: '删除看板',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          await submitDeleteDashboard(dashboardId);
        },
      });
    },
    [submitDeleteDashboard, visibleDashboards],
  );

  if (runtimeScopePage.guarding) {
    return (
      <DirectShellPageFrame
        activeNav="dashboard"
        flushBottomPadding
        stretchContent
      >
        <LoadingWrapper loading>
          <div />
        </LoadingWrapper>
      </DirectShellPageFrame>
    );
  }

  return (
    <DirectShellPageFrame
      activeNav="dashboard"
      flushBottomPadding
      stretchContent
    >
      <LoadingWrapper loading={loading}>
        <DashboardWorkbench>
          <DashboardWorkbenchRail
            activeDashboardId={activeDashboardId}
            canShowCacheSettings={canShowCacheSettings}
            dashboards={visibleDashboards}
            dashboardMutationTargetId={dashboardMutationTargetId}
            filteredDashboardSummaryItems={dashboardSummaryItems}
            hasDashboardSummaryItems={dashboardSummaryItems.length > 0}
            isDashboardReadonly={isDashboardReadonly}
            onCacheSettings={(dashboardId) =>
              void openCacheSettings(dashboardId)
            }
            onCreateDashboard={() => setCreateDashboardOpen(true)}
            onDeleteDashboard={onDeleteDashboard}
            onRefreshDashboard={(dashboardId) =>
              void refreshDashboard(dashboardId)
            }
            onRenameDashboard={onOpenRenameDashboard}
            onSelectDashboard={(dashboardId) => {
              void replaceDashboardRoute(dashboardId);
            }}
            onSelectItem={onSelectItem}
            onSetDefaultDashboard={(dashboardId) => {
              void submitSetDefaultDashboard(dashboardId);
            }}
            selectedDashboardItem={selectedDashboardItem}
          />

          <DashboardWorkbenchStage
            cacheSettingsDrawerProps={{
              ...cacheSettingsDrawer.state,
              loading: cacheSettingsSubmitting,
              onClose: cacheSettingsDrawer.closeDrawer,
            }}
            dashboardGridRef={dashboardGridRef}
            dashboardItems={dashboardItems}
            isDashboardReadonly={isDashboardReadonly}
            isSupportCached={isSupportCached}
            nextScheduleTime={visibleDashboardDetail?.nextScheduledAt}
            onCacheSettings={openCacheSettings}
            onDeleteItem={onDelete}
            onGoToThread={goToSourceThread}
            onItemUpdated={onDashboardItemUpdated}
            onRefreshAll={() => {
              dashboardGridRef.current?.onRefreshAll();
            }}
            onSubmitCacheSettings={submitCacheSettings}
            onUpdateChange={onUpdateChange as (layouts: any[]) => Promise<void>}
            readOnlySchedule={visibleDashboardDetail?.schedule as Schedule}
            runtimeScopeSelector={activeDashboardRuntimeSelector}
          />
        </DashboardWorkbench>
      </LoadingWrapper>
      <DashboardCreateModal
        confirmLoading={createDashboardLoading}
        description="为当前工作空间新增一个可承接图表结果的数据看板。"
        inputPlaceholder="例如：经营总览 / 销售日报"
        isDashboardReadonly={isDashboardReadonly}
        okText="创建看板"
        open={createDashboardOpen}
        title="新建看板"
        value={createDashboardName}
        onCancel={() => setCreateDashboardOpen(false)}
        onChangeValue={setCreateDashboardName}
        onSubmit={submitCreateDashboard}
      />
      <DashboardCreateModal
        confirmLoading={
          dashboardMutationTargetId === renameDashboardId &&
          dashboardMutationType === 'rename'
        }
        description="更新当前看板名称，不会影响已固定的图表内容。"
        inputPlaceholder="请输入新的看板名称"
        isDashboardReadonly={isDashboardReadonly}
        okText="保存名称"
        open={renameDashboardOpen}
        title="重命名看板"
        value={renameDashboardName}
        onCancel={() => {
          setRenameDashboardOpen(false);
          setRenameDashboardId(null);
          setRenameDashboardName('');
        }}
        onChangeValue={setRenameDashboardName}
        onSubmit={async () => {
          if (renameDashboardId == null) {
            return;
          }
          const success = await submitRenameDashboard(
            renameDashboardId,
            renameDashboardName,
          );
          if (success) {
            setRenameDashboardOpen(false);
            setRenameDashboardId(null);
            setRenameDashboardName('');
          }
        }}
      />
    </DirectShellPageFrame>
  );
}
