import { useCallback, useRef, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type { DashboardGridItem } from '@/components/pages/home/dashboardGrid';
import useDrawerAction from '@/hooks/useDrawerAction';
import {
  hasExplicitRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import type {
  DashboardDetailData,
  DashboardItemLayoutInput,
} from '@/utils/dashboardRest';
import {
  createDashboard,
  deleteDashboard,
  deleteDashboardItem,
  loadDashboardDetailPayload,
  updateDashboard,
  updateDashboardItemLayouts,
  updateDashboardSchedule,
} from '@/utils/dashboardRest';
import {
  fetchSettings,
  resolveSettingsConnection,
  type SettingsData,
} from '@/utils/settingsRest';
import {
  buildHomeSidebarThreadsRequestKey,
  getCachedHomeSidebarThreads,
  resolveHomeSidebarHeaderSelector,
  resolveHomeSidebarScopeKey,
  resolveHomeSidebarThreadSelector,
} from '@/hooks/homeSidebarHelpers';
import { loadHomeSidebarThreadsPayload } from '@/hooks/homeSidebarRequests';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';

import { isSupportCachedSettings } from './useManageDashboardData';

export type DashboardMutationType = 'rename' | 'delete' | 'default' | null;

export const useManageDashboardPageActions = ({
  activeDashboardId,
  cacheSettingsDrawer,
  createDashboardName,
  dashboardCacheEnabled,
  dashboardCreateSelector,
  resolveDashboardSelector,
  hasExecutableDashboardRuntime,
  isDashboardReadonly,
  refetchDashboard,
  refetchDashboards,
  replaceDashboardRoute,
  resolvedCacheSupport,
  runtimeScopeNavigation,
  runtimeScopePageHasRuntimeScope,
  selectedDashboardItemId,
  setCreateDashboardName,
  setCreateDashboardOpen,
  setSelectedDashboardItemId,
  setSettings,
  updateDashboardDetailData,
  visibleDashboardDetailCacheEnabled,
  visibleDashboardDetailSchedule,
}: {
  activeDashboardId: number | null;
  cacheSettingsDrawer: ReturnType<typeof useDrawerAction>;
  createDashboardName: string;
  dashboardCacheEnabled: boolean;
  dashboardCreateSelector: ClientRuntimeScopeSelector;
  resolveDashboardSelector: (
    dashboardId?: number | null,
  ) => ClientRuntimeScopeSelector;
  hasExecutableDashboardRuntime: boolean;
  isDashboardReadonly: boolean;
  refetchDashboard: (options?: {
    useCache?: boolean;
  }) => Promise<DashboardDetailData | null>;
  refetchDashboards: (options?: { useCache?: boolean }) => Promise<any[]>;
  replaceDashboardRoute: (dashboardId: number) => Promise<void>;
  resolvedCacheSupport: boolean | null;
  runtimeScopeNavigation: ReturnType<typeof useRuntimeScopeNavigation>;
  runtimeScopePageHasRuntimeScope: boolean;
  selectedDashboardItemId: number | null;
  setCreateDashboardName: (value: string) => void;
  setCreateDashboardOpen: (value: boolean) => void;
  setSelectedDashboardItemId: (value: number | null) => void;
  setSettings: (value: SettingsData | null) => void;
  updateDashboardDetailData: (
    updater: (previousData: DashboardDetailData) => DashboardDetailData,
  ) => void;
  visibleDashboardDetailCacheEnabled?: boolean | null;
  visibleDashboardDetailSchedule?: DashboardDetailData['schedule'];
}) => {
  const [createDashboardLoading, setCreateDashboardLoading] = useState(false);
  const [cacheSettingsTargetId, setCacheSettingsTargetId] = useState<
    number | null
  >(null);
  const [dashboardMutationTargetId, setDashboardMutationTargetId] = useState<
    number | null
  >(null);
  const [dashboardMutationType, setDashboardMutationType] =
    useState<DashboardMutationType>(null);
  const [cacheSettingsSubmitting, setCacheSettingsSubmitting] = useState(false);
  const cacheSettingsSubmittingRef = useRef(false);
  const workspaceScopeKey = resolveHomeSidebarScopeKey({
    workspaceId: runtimeScopeNavigation.workspaceSelector.workspaceId,
    runtimeScopeId: runtimeScopeNavigation.workspaceSelector.runtimeScopeId,
  });
  const workspaceThreadHeaderSelector = resolveHomeSidebarHeaderSelector({
    workspaceId: runtimeScopeNavigation.workspaceSelector.workspaceId,
    runtimeScopeId: runtimeScopeNavigation.workspaceSelector.runtimeScopeId,
  });

  const resolveSourceThreadSelector = useCallback(
    async (threadId: number): Promise<ClientRuntimeScopeSelector> => {
      const cachedThreads = getCachedHomeSidebarThreads(workspaceScopeKey);
      const cachedThread = cachedThreads.find(
        (thread) => Number(thread.id) === threadId,
      );
      if (
        cachedThread?.selector &&
        hasExplicitRuntimeScopeSelector(cachedThread.selector)
      ) {
        return cachedThread.selector;
      }

      try {
        const threads = await loadHomeSidebarThreadsPayload({
          requestUrl: buildHomeSidebarThreadsRequestKey(
            workspaceThreadHeaderSelector,
          ),
          cacheMode: 'no-store',
        });
        const matchedThread = threads.find(
          (thread) => Number(thread.id) === threadId,
        );
        if (matchedThread) {
          const selector = resolveHomeSidebarThreadSelector(matchedThread);
          if (hasExplicitRuntimeScopeSelector(selector)) {
            return selector;
          }
        }
      } catch (_error) {
        // fallback to workspace navigation selector below
      }

      return workspaceThreadHeaderSelector;
    },
    [workspaceScopeKey, workspaceThreadHeaderSelector],
  );

  const ensureCacheSettingsSupported = useCallback(
    async ({
      cacheEnabled,
      selector,
    }: {
      cacheEnabled?: boolean;
      selector: ClientRuntimeScopeSelector;
    }) => {
      if (
        cacheEnabled ||
        dashboardCacheEnabled ||
        resolvedCacheSupport === true
      ) {
        return true;
      }

      if (
        resolvedCacheSupport === false ||
        !runtimeScopePageHasRuntimeScope ||
        !hasExecutableDashboardRuntime
      ) {
        return false;
      }

      try {
        const result = await fetchSettings(selector);
        setSettings(result);
        return isSupportCachedSettings(resolveSettingsConnection(result));
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '加载系统设置失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        return false;
      }
    },
    [
      dashboardCacheEnabled,
      hasExecutableDashboardRuntime,
      resolvedCacheSupport,
      runtimeScopePageHasRuntimeScope,
      setSettings,
    ],
  );

  const openCacheSettings = useCallback(
    async (dashboardId?: number | null) => {
      if (isDashboardReadonly) {
        message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
        return;
      }

      const targetDashboardId = dashboardId ?? activeDashboardId;
      if (targetDashboardId == null) {
        return;
      }

      const targetSelector = resolveDashboardSelector(targetDashboardId);
      const supported = await ensureCacheSettingsSupported({
        cacheEnabled:
          targetDashboardId === activeDashboardId
            ? (visibleDashboardDetailCacheEnabled ?? dashboardCacheEnabled)
            : false,
        selector: targetSelector,
      });
      if (!supported) {
        message.info('当前连接暂不支持缓存与调度');
        return;
      }

      const detailData =
        targetDashboardId === activeDashboardId
          ? {
              cacheEnabled: visibleDashboardDetailCacheEnabled,
              schedule: visibleDashboardDetailSchedule,
            }
          : await loadDashboardDetailPayload({
              dashboardId: targetDashboardId,
              selector: targetSelector,
              useCache: false,
            }).catch((error) => {
              const errorMessage = resolveAbortSafeErrorMessage(
                error,
                '加载看板计划失败，请稍后重试。',
              );
              if (errorMessage) {
                message.error(errorMessage);
              }
              return null;
            });

      if (!detailData) {
        return;
      }

      setCacheSettingsTargetId(targetDashboardId);
      cacheSettingsDrawer.openDrawer({
        cacheEnabled: detailData.cacheEnabled,
        schedule: detailData.schedule,
      });
    },
    [
      activeDashboardId,
      cacheSettingsDrawer,
      dashboardCacheEnabled,
      ensureCacheSettingsSupported,
      isDashboardReadonly,
      resolveDashboardSelector,
      setCacheSettingsTargetId,
      visibleDashboardDetailCacheEnabled,
      visibleDashboardDetailSchedule,
    ],
  );

  const onUpdateChange = useCallback(
    async (layouts: DashboardItemLayoutInput[]) => {
      if (isDashboardReadonly || layouts.length === 0) {
        return;
      }

      try {
        const items = await updateDashboardItemLayouts(
          resolveDashboardSelector(activeDashboardId),
          layouts,
        );
        updateDashboardDetailData((previousData) => ({
          ...previousData,
          items,
        }));
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '更新看板布局失败。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    },
    [
      activeDashboardId,
      isDashboardReadonly,
      resolveDashboardSelector,
      updateDashboardDetailData,
    ],
  );

  const onDelete = useCallback(
    async (id: number) => {
      if (isDashboardReadonly) {
        message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
        return;
      }

      try {
        await deleteDashboardItem(
          resolveDashboardSelector(activeDashboardId),
          id,
        );
        message.success('看板项已删除。');
        if (selectedDashboardItemId === id) {
          setSelectedDashboardItemId(null);
        }
        updateDashboardDetailData((previousData) => ({
          ...previousData,
          items: previousData.items.filter((item) => item.id !== id),
        }));
        await refetchDashboards();
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除看板项失败，请稍后重试',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    },
    [
      activeDashboardId,
      isDashboardReadonly,
      refetchDashboards,
      resolveDashboardSelector,
      selectedDashboardItemId,
      setSelectedDashboardItemId,
      updateDashboardDetailData,
    ],
  );

  const onDashboardItemUpdated = useCallback(
    (updatedItem: DashboardGridItem) => {
      updateDashboardDetailData((previousData) => ({
        ...previousData,
        items: previousData.items.map((item) =>
          item.id === updatedItem.id ? updatedItem : item,
        ),
      }));
    },
    [updateDashboardDetailData],
  );

  const refreshDashboard = useCallback(
    async (dashboardId?: number | null) => {
      if (isDashboardReadonly) {
        message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
        return;
      }
      const targetDashboardId = dashboardId ?? activeDashboardId;
      if (targetDashboardId == null) {
        return;
      }

      try {
        if (targetDashboardId === activeDashboardId) {
          await refetchDashboard({ useCache: false });
        } else {
          const targetSelector = resolveDashboardSelector(targetDashboardId);
          await loadDashboardDetailPayload({
            dashboardId: targetDashboardId,
            selector: targetSelector,
            useCache: false,
          });
          message.success('看板已刷新。');
        }
        await refetchDashboards({ useCache: false });
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '刷新看板失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    },
    [
      activeDashboardId,
      isDashboardReadonly,
      refetchDashboard,
      refetchDashboards,
      resolveDashboardSelector,
    ],
  );

  const goToSourceThread = useCallback(
    async (threadId?: number | null, responseId?: number | null) => {
      if (threadId == null) {
        message.warning('当前卡片缺少来源线程信息。');
        return;
      }

      const selector = await resolveSourceThreadSelector(threadId);
      await runtimeScopeNavigation.push(
        `${Path.Home}/${threadId}`,
        {
          ...(responseId != null ? { responseId } : {}),
        },
        selector,
      );
    },
    [resolveSourceThreadSelector, runtimeScopeNavigation.push],
  );

  const submitCreateDashboard = useCallback(async () => {
    if (isDashboardReadonly) {
      message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
      return;
    }

    const normalizedName = createDashboardName.trim();
    if (!normalizedName) {
      message.warning('请输入看板名称。');
      return;
    }

    try {
      setCreateDashboardLoading(true);
      const dashboard = await createDashboard(dashboardCreateSelector, {
        name: normalizedName,
      });
      message.success('已创建看板。');
      setCreateDashboardOpen(false);
      setCreateDashboardName('');
      await refetchDashboards({ useCache: false });
      if (dashboard?.id != null) {
        await replaceDashboardRoute(dashboard.id);
      }
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建看板失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setCreateDashboardLoading(false);
    }
  }, [
    createDashboardName,
    dashboardCreateSelector,
    isDashboardReadonly,
    refetchDashboards,
    replaceDashboardRoute,
    setCreateDashboardName,
    setCreateDashboardOpen,
  ]);

  const submitRenameDashboard = useCallback(
    async (dashboardId: number, name: string) => {
      if (isDashboardReadonly) {
        message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
        return false;
      }

      const normalizedName = name.trim();
      if (!normalizedName) {
        message.warning('请输入看板名称。');
        return false;
      }

      try {
        setDashboardMutationTargetId(dashboardId);
        setDashboardMutationType('rename');
        await updateDashboard(
          resolveDashboardSelector(dashboardId),
          dashboardId,
          {
            name: normalizedName,
          },
        );
        message.success('看板已重命名。');
        await refetchDashboards({ useCache: false });
        if (activeDashboardId === dashboardId) {
          await refetchDashboard({ useCache: false });
        }
        return true;
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '重命名看板失败。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        return false;
      } finally {
        setDashboardMutationTargetId(null);
        setDashboardMutationType(null);
      }
    },
    [
      activeDashboardId,
      isDashboardReadonly,
      refetchDashboard,
      refetchDashboards,
      resolveDashboardSelector,
    ],
  );

  const submitDeleteDashboard = useCallback(
    async (dashboardId: number) => {
      if (isDashboardReadonly) {
        message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
        return null;
      }

      try {
        setDashboardMutationTargetId(dashboardId);
        setDashboardMutationType('delete');
        const fallbackDashboard = await deleteDashboard(
          resolveDashboardSelector(dashboardId),
          dashboardId,
        );
        message.success('看板已删除。');
        await refetchDashboards({ useCache: false });
        if (
          activeDashboardId === dashboardId &&
          fallbackDashboard?.id != null
        ) {
          await replaceDashboardRoute(fallbackDashboard.id);
        }
        return fallbackDashboard;
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除看板失败。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        return null;
      } finally {
        setDashboardMutationTargetId(null);
        setDashboardMutationType(null);
      }
    },
    [
      activeDashboardId,
      isDashboardReadonly,
      refetchDashboards,
      replaceDashboardRoute,
      resolveDashboardSelector,
    ],
  );

  const submitCacheSettings = useCallback(
    async (values: any) => {
      if (cacheSettingsSubmittingRef.current) {
        return;
      }

      const targetDashboardId = cacheSettingsTargetId ?? activeDashboardId;
      if (targetDashboardId == null) {
        return;
      }

      cacheSettingsSubmittingRef.current = true;
      setCacheSettingsSubmitting(true);

      try {
        await updateDashboardSchedule(
          resolveDashboardSelector(targetDashboardId),
          targetDashboardId,
          values,
        );
        message.success('看板计划已更新。');
        if (targetDashboardId === activeDashboardId) {
          await refetchDashboard({ useCache: false });
        } else {
          await loadDashboardDetailPayload({
            dashboardId: targetDashboardId,
            selector: resolveDashboardSelector(targetDashboardId),
            useCache: false,
          });
        }
        await refetchDashboards({ useCache: false });
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '更新看板计划失败，请稍后重试',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      } finally {
        cacheSettingsSubmittingRef.current = false;
        setCacheSettingsSubmitting(false);
      }
    },
    [
      activeDashboardId,
      cacheSettingsTargetId,
      refetchDashboard,
      refetchDashboards,
      resolveDashboardSelector,
    ],
  );

  const submitSetDefaultDashboard = useCallback(
    async (dashboardId: number) => {
      if (isDashboardReadonly) {
        message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
        return false;
      }

      try {
        setDashboardMutationTargetId(dashboardId);
        setDashboardMutationType('default');
        await updateDashboard(
          resolveDashboardSelector(dashboardId),
          dashboardId,
          {
            isDefault: true,
          },
        );
        message.success('已设为默认看板。');
        await refetchDashboards({ useCache: false });
        if (activeDashboardId === dashboardId) {
          await refetchDashboard({ useCache: false });
        }
        return true;
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '设置默认看板失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        return false;
      } finally {
        setDashboardMutationTargetId(null);
        setDashboardMutationType(null);
      }
    },
    [
      activeDashboardId,
      isDashboardReadonly,
      refetchDashboard,
      refetchDashboards,
      resolveDashboardSelector,
    ],
  );

  return {
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
  };
};
