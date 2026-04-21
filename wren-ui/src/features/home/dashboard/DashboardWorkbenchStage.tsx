import { appMessage as message } from '@/utils/antdAppBridge';
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
  DashboardStageCanvas,
} from './manageDashboardPageStyles';

export const DashboardWorkbenchStage = (props: {
  cacheSettingsDrawerProps: DrawerAction<any>;
  dashboardGridRef: React.RefObject<DashboardGridHandle>;
  dashboardItems: DashboardGridItem[];
  isDashboardReadonly: boolean;
  isSupportCached: boolean;
  nextScheduleTime?: string | null;
  onCacheSettings: () => void;
  onDeleteItem: (id: number) => Promise<void>;
  onGoToThread: (
    threadId?: number | null,
    responseId?: number | null,
  ) => Promise<void>;
  onItemUpdated: (item: DashboardGridItem) => void;
  onRefreshAll: () => void;
  onSubmitCacheSettings: (values: any) => Promise<void>;
  onUpdateChange: (layouts: any[]) => Promise<void>;
  readOnlySchedule?: Schedule;
  runtimeScopeSelector: any;
}) => {
  const {
    cacheSettingsDrawerProps,
    dashboardGridRef,
    dashboardItems,
    isDashboardReadonly,
    isSupportCached,
    nextScheduleTime,
    onCacheSettings,
    onDeleteItem,
    onGoToThread,
    onItemUpdated,
    onRefreshAll,
    onSubmitCacheSettings,
    onUpdateChange,
    readOnlySchedule,
    runtimeScopeSelector,
  } = props;

  return (
    <DashboardStage>
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
