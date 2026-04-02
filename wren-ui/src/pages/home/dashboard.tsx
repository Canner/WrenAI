import { useMemo, useRef } from 'react';
import { message } from 'antd';
import { Path } from '@/utils/enum';
import SiderLayout from '@/components/layouts/SiderLayout';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useDrawerAction from '@/hooks/useDrawerAction';
import { LoadingWrapper } from '@/components/PageLoading';
import DashboardGrid from '@/components/pages/home/dashboardGrid';
import EmptyDashboard from '@/components/pages/home/dashboardGrid/EmptyDashboard';
import DashboardHeader from '@/components/pages/home/dashboardGrid/DashboardHeader';
import CacheSettingsDrawer, {
  Schedule,
} from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import {
  useDashboardQuery,
  useDeleteDashboardItemMutation,
  useUpdateDashboardItemLayoutsMutation,
  useSetDashboardScheduleMutation,
} from '@/apollo/client/graphql/dashboard.generated';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import {
  DataSource,
  DataSourceName,
  ItemLayoutInput,
} from '@/apollo/client/graphql/__types__';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';

const isSupportCachedSettings = (dataSource: DataSource) => {
  // DuckDB not supported, sample dataset as well
  return (
    !dataSource?.sampleDataset && dataSource?.type !== DataSourceName.DUCKDB
  );
};

export default function Dashboard() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const dashboardGridRef = useRef<{ onRefreshAll: () => void }>(null);
  const homeSidebar = useHomeSidebar();
  const cacheSettingsDrawer = useDrawerAction();
  const { data: settingsResult } = useGetSettingsQuery({
    skip: !runtimeScopePage.hasRuntimeScope,
  });
  const settings = settingsResult?.settings;
  const isSupportCached = useMemo(
    () => isSupportCachedSettings(settings?.dataSource),
    [settings?.dataSource],
  );

  const {
    data,
    loading,
    updateQuery: updateDashboardQuery,
  } = useDashboardQuery({
    fetchPolicy: 'cache-and-network',
    skip: !runtimeScopePage.hasRuntimeScope,
    onError: () => {
      message.error('Failed to fetch dashboard items.');
      runtimeScopeNavigation.push(Path.Home);
    },
  });
  const dashboardItems = useMemo(
    () => data?.dashboard?.items || [],
    [data?.dashboard?.items],
  );

  const [setDashboardSchedule] = useSetDashboardScheduleMutation({
    refetchQueries: ['Dashboard'],
    onCompleted: () => {
      message.success('Successfully updated dashboard schedule.');
    },
    onError: (error) => console.error(error),
  });

  const [updateDashboardItemLayouts] = useUpdateDashboardItemLayoutsMutation({
    onError: () => {
      message.error('Failed to update dashboard item layouts.');
    },
  });
  const [deleteDashboardItem] = useDeleteDashboardItemMutation({
    onError: (error) => console.error(error),
    onCompleted: (_, query) => {
      message.success('Successfully deleted dashboard item.');
      onRemoveDashboardItemFromQueryCache(query.variables.where.id);
    },
  });

  const onRemoveDashboardItemFromQueryCache = (id: number) => {
    updateDashboardQuery((prev) => {
      return {
        ...prev,
        dashboard: {
          ...prev.dashboard,
          items: prev?.dashboard?.items?.filter((item) => item.id !== id) || [],
        },
      };
    });
  };

  const onUpdateChange = async (layouts: ItemLayoutInput[]) => {
    if (layouts && layouts.length > 0) {
      await updateDashboardItemLayouts({ variables: { data: { layouts } } });
    }
  };

  const onDelete = async (id: number) => {
    await deleteDashboardItem({ variables: { where: { id } } });
  };

  if (runtimeScopePage.guarding) {
    return <SiderLayout loading color="gray-3" sidebar={homeSidebar} />;
  }

  return (
    <SiderLayout loading={loading} color="gray-3" sidebar={homeSidebar}>
      <LoadingWrapper loading={loading}>
        <>
          <EmptyDashboard show={dashboardItems.length === 0}>
            <DashboardHeader
              isSupportCached={isSupportCached}
              schedule={data?.dashboard?.schedule as Schedule}
              nextScheduleTime={data?.dashboard?.nextScheduledAt}
              onCacheSettings={() => {
                cacheSettingsDrawer.openDrawer({
                  cacheEnabled: data?.dashboard?.cacheEnabled,
                  schedule: data?.dashboard?.schedule,
                });
              }}
              onRefreshAll={() => {
                dashboardGridRef?.current?.onRefreshAll();
              }}
            />
            <DashboardGrid
              ref={dashboardGridRef}
              items={dashboardItems}
              isSupportCached={isSupportCached}
              onUpdateChange={onUpdateChange}
              onDelete={onDelete}
            />
          </EmptyDashboard>
          {isSupportCached && (
            <CacheSettingsDrawer
              {...cacheSettingsDrawer.state}
              onClose={cacheSettingsDrawer.closeDrawer}
              onSubmit={async (values) => {
                await setDashboardSchedule({ variables: { data: values } });
              }}
            />
          )}
        </>
      </LoadingWrapper>
    </SiderLayout>
  );
}
