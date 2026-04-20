import { useCallback, useState } from 'react';
import { message } from 'antd';

import type { DashboardGridItem } from '@/components/pages/home/dashboardGrid';
import useDrawerAction from '@/hooks/useDrawerAction';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import type {
  DashboardDetailData,
  DashboardItemLayoutInput,
} from '@/utils/dashboardRest';
import {
  createDashboard,
  deleteDashboard,
  deleteDashboardItem,
  updateDashboard,
  updateDashboardItemLayouts,
  updateDashboardSchedule,
} from '@/utils/dashboardRest';
import {
  fetchSettings,
  resolveSettingsConnection,
  type SettingsData,
} from '@/utils/settingsRest';
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
  const [dashboardMutationTargetId, setDashboardMutationTargetId] = useState<
    number | null
  >(null);
  const [dashboardMutationType, setDashboardMutationType] =
    useState<DashboardMutationType>(null);

  const ensureCacheSettingsSupported = useCallback(async () => {
    if (dashboardCacheEnabled || resolvedCacheSupport === true) {
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
      const result = await fetchSettings(runtimeScopeNavigation.selector);
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
  }, [
    dashboardCacheEnabled,
    hasExecutableDashboardRuntime,
    resolvedCacheSupport,
    runtimeScopeNavigation.selector,
    runtimeScopePageHasRuntimeScope,
    setSettings,
  ]);

  const openCacheSettings = useCallback(async () => {
    if (isDashboardReadonly) {
      message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
      return;
    }

    const supported = await ensureCacheSettingsSupported();
    if (!supported) {
      message.info('当前连接暂不支持缓存与调度');
      return;
    }

    cacheSettingsDrawer.openDrawer({
      cacheEnabled: visibleDashboardDetailCacheEnabled,
      schedule: visibleDashboardDetailSchedule,
    });
  }, [
    cacheSettingsDrawer,
    ensureCacheSettingsSupported,
    isDashboardReadonly,
    visibleDashboardDetailCacheEnabled,
    visibleDashboardDetailSchedule,
  ]);

  const onUpdateChange = useCallback(
    async (layouts: DashboardItemLayoutInput[]) => {
      if (isDashboardReadonly || layouts.length === 0) {
        return;
      }

      try {
        const items = await updateDashboardItemLayouts(
          runtimeScopeNavigation.selector,
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
      isDashboardReadonly,
      runtimeScopeNavigation.selector,
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
        await deleteDashboardItem(runtimeScopeNavigation.selector, id);
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
      isDashboardReadonly,
      refetchDashboards,
      runtimeScopeNavigation.selector,
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

  const refreshActiveDashboard = useCallback(async () => {
    if (isDashboardReadonly) {
      message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
      return;
    }
    if (activeDashboardId == null) {
      return;
    }
    await refetchDashboard();
    await refetchDashboards();
  }, [
    activeDashboardId,
    isDashboardReadonly,
    refetchDashboard,
    refetchDashboards,
  ]);

  const goToSourceThread = useCallback(
    async (threadId?: number | null, responseId?: number | null) => {
      if (threadId == null) {
        message.warning('当前卡片缺少来源线程信息。');
        return;
      }

      await runtimeScopeNavigation.pushWorkspace(`${Path.Home}/${threadId}`, {
        ...(responseId != null ? { responseId } : {}),
      });
    },
    [runtimeScopeNavigation],
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
      const dashboard = await createDashboard(runtimeScopeNavigation.selector, {
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
    isDashboardReadonly,
    refetchDashboards,
    replaceDashboardRoute,
    runtimeScopeNavigation.selector,
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
        await updateDashboard(runtimeScopeNavigation.selector, dashboardId, {
          name: normalizedName,
        });
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
      runtimeScopeNavigation.selector,
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
          runtimeScopeNavigation.selector,
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
      runtimeScopeNavigation.selector,
    ],
  );

  const submitCacheSettings = useCallback(
    async (values: any) => {
      if (activeDashboardId == null) {
        return;
      }
      try {
        await updateDashboardSchedule(
          runtimeScopeNavigation.selector,
          activeDashboardId,
          values,
        );
        message.success('看板计划已更新。');
        await refetchDashboard({ useCache: false });
        await refetchDashboards({ useCache: false });
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '更新看板计划失败，请稍后重试',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    },
    [
      activeDashboardId,
      refetchDashboard,
      refetchDashboards,
      runtimeScopeNavigation.selector,
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
        await updateDashboard(runtimeScopeNavigation.selector, dashboardId, {
          isDefault: true,
        });
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
      runtimeScopeNavigation.selector,
    ],
  );

  return {
    createDashboardLoading,
    dashboardMutationTargetId,
    dashboardMutationType,
    goToSourceThread,
    onDashboardItemUpdated,
    onDelete,
    onUpdateChange,
    openCacheSettings,
    refreshActiveDashboard,
    submitCacheSettings,
    submitCreateDashboard,
    submitDeleteDashboard,
    submitRenameDashboard,
    submitSetDefaultDashboard,
  };
};
