import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Input, Modal, message } from 'antd';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import useDrawerAction from '@/hooks/useDrawerAction';
import { LoadingWrapper } from '@/components/PageLoading';
import DashboardGrid, {
  DashboardGridHandle,
} from '@/components/pages/home/dashboardGrid';
import type { DashboardGridItem } from '@/components/pages/home/dashboardGrid';
import EmptyDashboard from '@/components/pages/home/dashboardGrid/EmptyDashboard';
import DashboardHeader from '@/components/pages/home/dashboardGrid/DashboardHeader';
import CacheSettingsDrawer, {
  Schedule,
} from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import { DataSourceName } from '@/types/dataSource';
import { hasExecutableRuntimeScopeSelector } from '@/runtime/client/runtimeScope';

import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import {
  HISTORICAL_SNAPSHOT_READONLY_HINT,
  isHistoricalSnapshotReadonly,
} from '@/utils/runtimeSnapshot';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  createDashboard,
  loadDashboardDetailPayload,
  loadDashboardListPayload,
  peekDashboardDetailPayload,
  peekDashboardListPayload,
  primeDashboardDetailPayload,
  type DashboardDetailData,
  type DashboardItemLayoutInput,
  type DashboardListItem,
  updateDashboardItemLayouts,
  updateDashboardSchedule,
  deleteDashboardItem,
} from '@/utils/dashboardRest';
import {
  fetchSettings,
  resolveSettingsConnection,
  type KnowledgeConnectionSettings,
  type SettingsData,
} from '@/utils/settingsRest';

const DashboardWorkbench = styled.div`
  width: min(100%, 1480px);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 312px minmax(0, 1fr);
  gap: 18px;
  align-items: start;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

const DashboardRail = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const DashboardRailCard = styled.section`
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--nova-shadow-soft);
  padding: 18px;
`;

const DashboardRailList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
`;

const DashboardRailItem = styled.button<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(141, 101, 225, 0.18)' : 'var(--nova-outline-soft)'};
  border-radius: 16px;
  background: ${(props) =>
    props.$active
      ? 'linear-gradient(180deg, rgba(238, 233, 252, 0.92) 0%, rgba(255, 255, 255, 0.98) 100%)'
      : 'rgba(255, 255, 255, 0.94)'};
  padding: 13px 14px;
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;

  &:hover {
    border-color: rgba(141, 101, 225, 0.18);
    transform: translateY(-1px);
    box-shadow: 0 14px 24px -18px rgba(31, 35, 50, 0.26);
  }
`;

const DashboardRailTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: var(--nova-text-primary);
`;

const DashboardRailMeta = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: var(--nova-text-secondary);
`;

const DashboardStage = styled.section`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const DashboardStageHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--nova-shadow-soft);

  @media (max-width: 960px) {
    flex-direction: column;
  }
`;

const DashboardStageHeading = styled.div`
  min-width: 0;
`;

const DashboardStageTitle = styled.h1`
  margin: 0;
  font-size: 30px;
  line-height: 1.2;
  font-weight: 700;
  color: var(--nova-text-primary);
`;

const DashboardStageMeta = styled.div`
  margin-top: 6px;
  font-size: 13px;
  color: var(--nova-text-secondary);
`;

const DashboardStageCanvas = styled.div<{ $empty?: boolean }>`
  min-width: 0;
  min-height: ${(props) => (props.$empty ? '560px' : '0')};
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: var(--nova-shadow-soft);
  overflow: auto;
`;

const DashboardQuickActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
`;

const WorkbenchActionButton = styled(Button)`
  && {
    height: 36px;
    border-radius: 10px;
    padding-inline: 14px;
    font-weight: 500;
    box-shadow: none;
  }
`;

const WorkbenchPrimaryActionButton = styled(WorkbenchActionButton)`
  && {
    border-color: transparent;
    box-shadow: 0 8px 18px rgba(111, 71, 255, 0.14);
  }
`;

const DashboardStageActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;

  @media (max-width: 960px) {
    justify-content: flex-start;
  }
`;

const DashboardDetailStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
`;

const DashboardDetailRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--nova-text-secondary);
`;

const DashboardPill = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(141, 101, 225, 0.12);
  color: var(--nova-primary);
  font-size: 12px;
  font-weight: 600;
`;

const isSupportCachedSettings = (
  connection?: KnowledgeConnectionSettings | null,
) => {
  if (!connection) {
    return false;
  }

  return (
    !connection.sampleDataset && connection.type !== DataSourceName.DUCKDB
  );
};

const normalizeDashboardError = (error: unknown, fallbackMessage: string) =>
  error instanceof Error ? error : new Error(fallbackMessage);

const useDashboardListData = ({
  enabled,
  selector,
  onError,
}: {
  enabled: boolean;
  selector: ReturnType<typeof useRuntimeScopeNavigation>['selector'];
  onError?: (error: Error) => void;
}) => {
  const initialData = useMemo(() => {
    if (!enabled) {
      return [] as DashboardListItem[];
    }

    return peekDashboardListPayload({ selector }) || [];
  }, [
    enabled,
    selector.deployHash,
    selector.kbSnapshotId,
    selector.knowledgeBaseId,
    selector.runtimeScopeId,
    selector.workspaceId,
  ]);
  const [data, setData] = useState<DashboardListItem[]>(initialData);
  const [loading, setLoading] = useState(
    Boolean(enabled && initialData.length === 0),
  );

  useEffect(() => {
    setData(initialData);
    setLoading(Boolean(enabled && initialData.length === 0));
  }, [enabled, initialData]);

  const refetch = useCallback(
    async ({ useCache = false }: { useCache?: boolean } = {}) => {
      if (!enabled) {
        setData([]);
        setLoading(false);
        return [] as DashboardListItem[];
      }

      setLoading(true);

      try {
        const payload = await loadDashboardListPayload({
          selector,
          useCache,
        });
        setData(payload);
        return payload;
      } catch (error) {
        const normalizedError = normalizeDashboardError(
          error,
          '加载看板列表失败。',
        );
        onError?.(normalizedError);
        throw normalizedError;
      } finally {
        setLoading(false);
      }
    },
    [enabled, onError, selector],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refetch({ useCache: true }).catch(() => null);
  }, [enabled, refetch]);

  return {
    data,
    loading,
    refetch,
  };
};

const useDashboardDetailData = ({
  dashboardId,
  enabled,
  selector,
  onError,
}: {
  dashboardId?: number | null;
  enabled: boolean;
  selector: ReturnType<typeof useRuntimeScopeNavigation>['selector'];
  onError?: (error: Error) => void;
}) => {
  const initialData = useMemo(() => {
    if (!enabled || dashboardId == null) {
      return null;
    }

    return peekDashboardDetailPayload({
      selector,
      dashboardId,
    });
  }, [
    dashboardId,
    enabled,
    selector.deployHash,
    selector.kbSnapshotId,
    selector.knowledgeBaseId,
    selector.runtimeScopeId,
    selector.workspaceId,
  ]);
  const [data, setData] = useState<DashboardDetailData | null>(initialData);
  const [loading, setLoading] = useState(
    Boolean(enabled && dashboardId != null && !initialData),
  );

  useEffect(() => {
    setData(initialData);
    setLoading(Boolean(enabled && dashboardId != null && !initialData));
  }, [dashboardId, enabled, initialData]);

  const refetch = useCallback(
    async ({ useCache = false }: { useCache?: boolean } = {}) => {
      if (!enabled || dashboardId == null) {
        setData(null);
        setLoading(false);
        return null;
      }

      setLoading(true);

      try {
        const payload = await loadDashboardDetailPayload({
          dashboardId,
          selector,
          useCache,
        });
        setData(payload);
        return payload;
      } catch (error) {
        const normalizedError = normalizeDashboardError(
          error,
          '加载看板项失败。',
        );
        onError?.(normalizedError);
        throw normalizedError;
      } finally {
        setLoading(false);
      }
    },
    [dashboardId, enabled, onError, selector],
  );

  useEffect(() => {
    if (!enabled || dashboardId == null) {
      return;
    }

    void refetch({ useCache: true }).catch(() => null);
  }, [dashboardId, enabled, refetch]);

  const updateData = useCallback(
    (updater: (previousData: DashboardDetailData) => DashboardDetailData) => {
      setData((previousData) => {
        if (!previousData) {
          return previousData;
        }

        const nextData = updater(previousData);
        if (dashboardId != null) {
          primeDashboardDetailPayload({
            selector,
            dashboardId,
            payload: nextData,
          });
        }
        return nextData;
      });
    },
    [dashboardId, selector],
  );

  return {
    data,
    loading,
    refetch,
    updateData,
  };
};

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
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
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

  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [createDashboardLoading, setCreateDashboardLoading] = useState(false);
  const resolvedCacheSupport = useMemo(() => {
    const connection = resolveSettingsConnection(settings);
    if (!connection) {
      return null;
    }

    return isSupportCachedSettings(connection);
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
        {
          dashboardId,
        },
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

  const ensureCacheSettingsSupported = useCallback(async () => {
    if (dashboardCacheEnabled || resolvedCacheSupport === true) {
      return true;
    }

    if (
      resolvedCacheSupport === false ||
      !runtimeScopePage.hasRuntimeScope ||
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
    runtimeScopePage.hasRuntimeScope,
    runtimeScopeNavigation.selector,
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
      cacheEnabled: visibleDashboardDetail?.cacheEnabled,
      schedule: visibleDashboardDetail?.schedule,
    });
  }, [
    cacheSettingsDrawer,
    ensureCacheSettingsSupported,
    isDashboardReadonly,
    visibleDashboardDetail?.cacheEnabled,
    visibleDashboardDetail?.schedule,
  ]);

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
  }, [dashboardSummaryItems, cardKeyword]);

  const selectedDashboardItem = useMemo(() => {
    const selectedFromState = dashboardItems.find(
      (item) => item.id === selectedDashboardItemId,
    );
    return selectedFromState || dashboardItems[0] || null;
  }, [dashboardItems, selectedDashboardItemId]);

  const onUpdateChange = async (layouts: DashboardItemLayoutInput[]) => {
    if (isDashboardReadonly) {
      return;
    }
    if (layouts && layouts.length > 0) {
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
    }
  };

  const onDelete = async (id: number) => {
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
  };

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

  const selectDashboard = async (dashboardId: number) => {
    setSelectedDashboardItemId(null);
    await replaceDashboardRoute(dashboardId);
  };

  const refreshActiveDashboard = async () => {
    if (isDashboardReadonly) {
      message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
      return;
    }
    if (activeDashboardId == null) {
      return;
    }
    await refetchDashboard();
    await refetchDashboards();
  };

  const goToSourceThread = async (
    threadId?: number | null,
    responseId?: number | null,
  ) => {
    if (threadId == null) {
      message.warning('当前卡片缺少来源线程信息。');
      return;
    }

    await runtimeScopeNavigation.pushWorkspace(`${Path.Home}/${threadId}`, {
      ...(responseId != null ? { responseId } : {}),
    });
  };

  const submitCreateDashboard = async () => {
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
      await refetchDashboards();
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
          <DashboardRail>
            <DashboardRailCard>
              <div className="console-panel-title">看板</div>
              <Input.Search
                allowClear
                value={dashboardKeyword}
                onChange={(event) => setDashboardKeyword(event.target.value)}
                placeholder="搜索看板名称"
                style={{ marginTop: 12 }}
              />
              <DashboardQuickActions>
                <WorkbenchPrimaryActionButton
                  type="primary"
                  disabled={isDashboardReadonly}
                  onClick={() => setCreateDashboardOpen(true)}
                >
                  新建看板
                </WorkbenchPrimaryActionButton>
              </DashboardQuickActions>
              <DashboardRailList>
                {filteredDashboards.length === 0 ? (
                  <DashboardRailMeta>
                    当前工作空间下还没有匹配的看板。
                  </DashboardRailMeta>
                ) : (
                  filteredDashboards.map((dashboard) => (
                    <DashboardRailItem
                      key={dashboard.id}
                      type="button"
                      $active={activeDashboardId === dashboard.id}
                      onClick={() => void selectDashboard(dashboard.id)}
                    >
                      <DashboardRailTitle>{dashboard.name}</DashboardRailTitle>
                      <DashboardRailMeta>
                        {dashboard.cacheEnabled ? '缓存调度已开启' : '实时模式'}{' '}
                        · {dashboard.scheduleFrequency || '按需刷新'}
                      </DashboardRailMeta>
                    </DashboardRailItem>
                  ))
                )}
              </DashboardRailList>
            </DashboardRailCard>

            <DashboardRailCard>
              <div className="console-panel-title">图表</div>
              <Input.Search
                allowClear
                value={cardKeyword}
                onChange={(event) => setCardKeyword(event.target.value)}
                placeholder="搜索图表名称或类型"
                style={{ marginTop: 12 }}
              />
              <DashboardRailList>
                {filteredDashboardSummaryItems.length === 0 ? (
                  <DashboardRailMeta>
                    当前看板还没有图表卡片。
                  </DashboardRailMeta>
                ) : (
                  filteredDashboardSummaryItems.map((item) => (
                    <DashboardRailItem
                      key={item.id}
                      type="button"
                      $active={selectedDashboardItem?.id === item.id}
                      onClick={() => {
                        setSelectedDashboardItemId(item.id);
                        dashboardGridRef.current?.focusItem(item.id);
                      }}
                    >
                      <DashboardRailTitle>{item.title}</DashboardRailTitle>
                      <DashboardRailMeta>{item.meta}</DashboardRailMeta>
                    </DashboardRailItem>
                  ))
                )}
              </DashboardRailList>
            </DashboardRailCard>

            <DashboardRailCard>
              <div className="console-panel-title">选中图表</div>
              {selectedDashboardItem ? (
                <DashboardDetailStack>
                  <DashboardRailTitle>
                    {selectedDashboardItem.displayName ||
                      `图表卡片 ${selectedDashboardItem.id}`}
                  </DashboardRailTitle>
                  <DashboardDetailRow>
                    <span>图表类型</span>
                    <DashboardPill>{selectedDashboardItem.type}</DashboardPill>
                  </DashboardDetailRow>
                  <DashboardDetailRow>
                    <span>布局尺寸</span>
                    <span>
                      {selectedDashboardItem.layout.w} ×{' '}
                      {selectedDashboardItem.layout.h}
                    </span>
                  </DashboardDetailRow>
                  <DashboardDetailRow>
                    <span>SQL 状态</span>
                    <span>
                      {selectedDashboardItem.detail?.sql
                        ? '已生成 SQL'
                        : '待补充 SQL'}
                    </span>
                  </DashboardDetailRow>
                  <DashboardDetailRow>
                    <span>来源线程</span>
                    <span>
                      {selectedDashboardItem.detail?.sourceThreadId != null
                        ? `#${selectedDashboardItem.detail.sourceThreadId}`
                        : '未记录'}
                    </span>
                  </DashboardDetailRow>
                  <DashboardDetailRow>
                    <span>来源回答</span>
                    <span>
                      {selectedDashboardItem.detail?.sourceResponseId != null
                        ? `#${selectedDashboardItem.detail.sourceResponseId}`
                        : '未记录'}
                    </span>
                  </DashboardDetailRow>
                  {selectedDashboardItem.detail?.sourceQuestion ? (
                    <DashboardDetailRow>
                      <span>来源问题</span>
                      <span
                        title={selectedDashboardItem.detail.sourceQuestion}
                        style={{
                          flex: 1,
                          textAlign: 'right',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {selectedDashboardItem.detail.sourceQuestion}
                      </span>
                    </DashboardDetailRow>
                  ) : null}
                  <DashboardQuickActions>
                    <WorkbenchActionButton
                      onClick={() =>
                        dashboardGridRef?.current?.focusItem(
                          selectedDashboardItem.id,
                        )
                      }
                    >
                      定位到画布
                    </WorkbenchActionButton>
                    <WorkbenchActionButton
                      onClick={() =>
                        void goToSourceThread(
                          selectedDashboardItem.detail?.sourceThreadId,
                          selectedDashboardItem.detail?.sourceResponseId,
                        )
                      }
                    >
                      回到来源线程
                    </WorkbenchActionButton>
                    <WorkbenchActionButton
                      danger
                      disabled={isDashboardReadonly}
                      onClick={() => void onDelete(selectedDashboardItem.id)}
                    >
                      删除当前卡片
                    </WorkbenchActionButton>
                  </DashboardQuickActions>
                </DashboardDetailStack>
              ) : (
                <DashboardRailMeta>
                  先从问答结果中固定图表到看板。
                </DashboardRailMeta>
              )}
            </DashboardRailCard>
          </DashboardRail>

          <DashboardStage>
            <DashboardStageHeader>
              <DashboardStageHeading>
                <DashboardStageTitle>
                  {visibleDashboardDetail?.name ||
                    activeDashboard?.name ||
                    '默认看板'}
                </DashboardStageTitle>
                <DashboardStageMeta>
                  {dashboardItems.length} 张卡片 ·{' '}
                  {isDashboardReadonly
                    ? '历史快照只读'
                    : dashboardCacheEnabled
                      ? '缓存调度已开启'
                      : '实时刷新'}
                </DashboardStageMeta>
              </DashboardStageHeading>
              <DashboardStageActions>
                <WorkbenchPrimaryActionButton
                  type="primary"
                  onClick={() =>
                    runtimeScopeNavigation.pushWorkspace(Path.Home)
                  }
                >
                  去新对话生成图表
                </WorkbenchPrimaryActionButton>
                <WorkbenchActionButton
                  onClick={() => void refreshActiveDashboard()}
                  disabled={isDashboardReadonly}
                >
                  刷新看板
                </WorkbenchActionButton>
                {canShowCacheSettings ? (
                  <WorkbenchActionButton
                    onClick={() => void openCacheSettings()}
                    disabled={isDashboardReadonly}
                  >
                    缓存与调度
                  </WorkbenchActionButton>
                ) : null}
              </DashboardStageActions>
            </DashboardStageHeader>
            <DashboardStageCanvas $empty={dashboardItems.length === 0}>
              <EmptyDashboard show={dashboardItems.length === 0}>
                <DashboardHeader
                  isSupportCached={isSupportCached}
                  readOnly={isDashboardReadonly}
                  schedule={visibleDashboardDetail?.schedule as Schedule}
                  nextScheduleTime={
                    visibleDashboardDetail?.nextScheduledAt ?? undefined
                  }
                  onCacheSettings={() => {
                    void openCacheSettings();
                  }}
                  onRefreshAll={() => {
                    dashboardGridRef?.current?.onRefreshAll();
                  }}
                />
                <DashboardGrid
                  ref={dashboardGridRef}
                  items={dashboardItems}
                  isSupportCached={isSupportCached}
                  readOnly={isDashboardReadonly}
                  runtimeScopeSelector={runtimeScopeNavigation.selector}
                  onUpdateChange={onUpdateChange}
                  onDelete={onDelete}
                  onItemUpdated={onDashboardItemUpdated}
                  onNavigateToThread={goToSourceThread}
                />
              </EmptyDashboard>
            </DashboardStageCanvas>
            {isSupportCached && (
              <CacheSettingsDrawer
                {...cacheSettingsDrawer.state}
                onClose={cacheSettingsDrawer.closeDrawer}
                onSubmit={async (values) => {
                  if (isDashboardReadonly) {
                    message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
                    return;
                  }
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
                    await refetchDashboard();
                    await refetchDashboards();
                  } catch (error) {
                    const errorMessage = resolveAbortSafeErrorMessage(
                      error,
                      '更新看板计划失败，请稍后重试',
                    );
                    if (errorMessage) {
                      message.error(errorMessage);
                    }
                  }
                }}
              />
            )}
          </DashboardStage>
        </DashboardWorkbench>
      </LoadingWrapper>
      <Modal
        title="新建看板"
        visible={createDashboardOpen}
        onCancel={() => setCreateDashboardOpen(false)}
        onOk={() => void submitCreateDashboard()}
        confirmLoading={createDashboardLoading}
        okButtonProps={{ disabled: isDashboardReadonly }}
        okText="创建看板"
        cancelText="取消"
      >
        <div style={{ color: 'var(--nova-text-secondary)', marginBottom: 12 }}>
          为当前工作空间新增一个可承接图表结果的数据看板。
        </div>
        <Input
          autoFocus
          value={createDashboardName}
          placeholder="例如：经营总览 / 销售日报"
          onChange={(event) => setCreateDashboardName(event.target.value)}
          onPressEnter={() => void submitCreateDashboard()}
        />
      </Modal>
    </ConsoleShellLayout>
  );
}
