import { useMemo } from 'react';
import { message } from 'antd';
import { Path } from '@/utils/enum';
import { useRouter } from 'next/router';
import SiderLayout from '@/components/layouts/SiderLayout';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import { LoadingWrapper } from '@/components/PageLoading';
import DashboardGrid from '@/components/pages/home/dashboardGrid';
import EmptyDashboard from '@/components/pages/home/dashboardGrid/EmptyDashboard';
import DashboardHeader from '@/components/pages/home/dashboardGrid/DashboardHeader';
import {
  useDashboardItemsQuery,
  useDeleteDashboardItemMutation,
  useUpdateDashboardItemLayoutsMutation,
} from '@/apollo/client/graphql/dashboard.generated';
import { ItemLayoutInput } from '@/apollo/client/graphql/__types__';

export default function Dashboard() {
  const router = useRouter();
  const homeSidebar = useHomeSidebar();

  const {
    data,
    loading,
    updateQuery: updateDashboardItemQuery,
  } = useDashboardItemsQuery({
    fetchPolicy: 'cache-and-network',
    onError: () => {
      message.error('Failed to fetch dashboard items.');
      router.push(Path.Home);
    },
  });
  const dashboardItems = useMemo(() => data?.dashboardItems || [], [data]);

  const [updateDashboardItemLayouts] = useUpdateDashboardItemLayoutsMutation({
    onError: () => {
      message.error('Failed to update dashboard item layouts.');
    },
  });
  const [deleteDashboardItem] = useDeleteDashboardItemMutation({
    onCompleted: (_, query) => {
      message.success('Successfully deleted dashboard item.');
      onRemoveDashboardItemFromQueryCache(query.variables.where.id);
    },
  });

  const onRemoveDashboardItemFromQueryCache = (id: number) => {
    updateDashboardItemQuery((prev) => {
      return {
        ...prev,
        dashboardItems:
          prev?.dashboardItems?.filter((item) => item.id !== id) || [],
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

  return (
    <SiderLayout loading={false} color="gray-3" sidebar={homeSidebar}>
      <LoadingWrapper loading={loading}>
        <EmptyDashboard show={dashboardItems.length === 0}>
          <DashboardHeader />
          <DashboardGrid
            items={dashboardItems}
            onUpdateChange={onUpdateChange}
            onDelete={onDelete}
          />
        </EmptyDashboard>
      </LoadingWrapper>
    </SiderLayout>
  );
}
