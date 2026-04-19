import { message } from 'antd';

import EmptyDashboard from '@/components/pages/home/dashboardGrid/EmptyDashboard';
import DashboardGrid from '@/components/pages/home/dashboardGrid';
import DashboardHeader from '@/components/pages/home/dashboardGrid/DashboardHeader';
import type {
  DashboardGridHandle,
  DashboardGridItem,
} from '@/components/pages/home/dashboardGrid';
import CacheSettingsDrawer from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import type { Schedule } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import type { DrawerAction } from '@/hooks/useDrawerAction';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';

import {
  DashboardStage,
  DashboardStageActions,
  DashboardStageCanvas,
  DashboardStageHeader,
  DashboardStageHeading,
  DashboardStageMeta,
  DashboardStageTitle,
  WorkbenchActionButton,
  WorkbenchPrimaryActionButton,
} from './manageDashboardPageStyles';

export const DashboardWorkbenchStage = (props: {
  activeDashboardName?: string | null;
  cacheSettingsDrawerProps: DrawerAction<any>;
  canShowCacheSettings: boolean;
  dashboardCacheEnabled: boolean;
  dashboardGridRef: React.RefObject<DashboardGridHandle>;
  dashboardItems: DashboardGridItem[];
  isDashboardReadonly: boolean;
  isSupportCached: boolean;
  nextScheduleTime?: string | null;
  onCacheSettings: () => void;
  onCreateChart: () => void;
  onDeleteItem: (id: number) => Promise<void>;
  onGoToThread: (
    threadId?: number | null,
    responseId?: number | null,
  ) => Promise<void>;
  onItemUpdated: (item: DashboardGridItem) => void;
  onRefreshAll: () => void;
  onRefreshDashboard: () => void;
  onSubmitCacheSettings: (values: any) => Promise<void>;
  onUpdateChange: (layouts: any[]) => Promise<void>;
  readOnlySchedule?: Schedule;
  runtimeScopeSelector: any;
}) => {
  const {
    activeDashboardName,
    cacheSettingsDrawerProps,
    canShowCacheSettings,
    dashboardCacheEnabled,
    dashboardGridRef,
    dashboardItems,
    isDashboardReadonly,
    isSupportCached,
    nextScheduleTime,
    onCacheSettings,
    onCreateChart,
    onDeleteItem,
    onGoToThread,
    onItemUpdated,
    onRefreshAll,
    onRefreshDashboard,
    onSubmitCacheSettings,
    onUpdateChange,
    readOnlySchedule,
    runtimeScopeSelector,
  } = props;

  return (
    <DashboardStage>
      <DashboardStageHeader>
        <DashboardStageHeading>
          <DashboardStageTitle>
            {activeDashboardName || '默认看板'}
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
          <WorkbenchPrimaryActionButton type="primary" onClick={onCreateChart}>
            去新对话生成图表
          </WorkbenchPrimaryActionButton>
          <WorkbenchActionButton
            onClick={() => void onRefreshDashboard()}
            disabled={isDashboardReadonly}
          >
            刷新看板
          </WorkbenchActionButton>
          {canShowCacheSettings ? (
            <WorkbenchActionButton
              onClick={() => void onCacheSettings()}
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
            schedule={readOnlySchedule}
            nextScheduleTime={nextScheduleTime ?? undefined}
            onCacheSettings={() => {
              void onCacheSettings();
            }}
            onRefreshAll={() => {
              onRefreshAll();
            }}
          />
          <DashboardGrid
            ref={dashboardGridRef}
            items={dashboardItems}
            isSupportCached={isSupportCached}
            readOnly={isDashboardReadonly}
            runtimeScopeSelector={runtimeScopeSelector}
            onUpdateChange={onUpdateChange}
            onDelete={onDeleteItem}
            onItemUpdated={onItemUpdated}
            onNavigateToThread={onGoToThread}
          />
        </EmptyDashboard>
      </DashboardStageCanvas>
      {isSupportCached ? (
        <CacheSettingsDrawer
          {...cacheSettingsDrawerProps}
          onSubmit={async (values) => {
            if (isDashboardReadonly) {
              message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
              return;
            }
            await onSubmitCacheSettings(values);
          }}
        />
      ) : null}
    </DashboardStage>
  );
};
