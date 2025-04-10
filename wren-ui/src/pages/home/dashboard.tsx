import { useMemo } from 'react';
import { message } from 'antd';
import { Path } from '@/utils/enum';
import { useRouter } from 'next/router';
import SiderLayout from '@/components/layouts/SiderLayout';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import DashboardGrid from '@/components/pages/home/dashboardGrid';
import EmptyDashboard from '@/components/pages/home/dashboardGrid/EmptyDashboard';
import {
  useDashboardItemsQuery,
  useDeleteDashboardItemMutation,
  useUpdateDashboardItemLayoutsMutation,
} from '@/apollo/client/graphql/dashboard.generated';
import { ItemLayoutInput } from '@/apollo/client/graphql/__types__';

export default function Dashboard() {
  const router = useRouter();
  const homeSidebar = useHomeSidebar();

  const { data, refetch } = useDashboardItemsQuery({
    fetchPolicy: 'cache-and-network',
    onError: (error) => {
      message.error(`Failed to fetch dashboard items: ${error.message}`);
      if (router.pathname !== Path.Home) {
        router.push(Path.Home);
      }
    },
  });

  const dashboardItems = useMemo(() => data?.dashboardItems || [], [data?.dashboardItems]);

  const [updateDashboardItemLayouts] = useUpdateDashboardItemLayoutsMutation({
    onError: (error) => {
      message.error(`Failed to update dashboard item layouts: ${error.message}`);
    },
  });

  const [deleteDashboardItem] = useDeleteDashboardItemMutation({
    onCompleted: () => {
      message.success('Successfully deleted dashboard item.');
      refetch();
    },
    onError: (error) => {
      message.error(`Failed to delete dashboard item: ${error.message}`);
    },
  });

  const onUpdateChange = async (layouts: ItemLayoutInput[]) => {
    if (!layouts || layouts.length === 0) return;

    try {
      await updateDashboardItemLayouts({ variables: { data: { layouts } } });
    } catch (error) {
      message.error(`Error updating layouts: ${error.message}`);
    }
  };

  const onDelete = async (id: number) => {
    try {
      await deleteDashboardItem({ variables: { where: { id } } });
    } catch (error) {
      message.error(`Error deleting dashboard item: ${error.message}`);
    }
  };

  return (
    <SiderLayout loading={false} color="gray-3" sidebar={homeSidebar}>
      <EmptyDashboard show={dashboardItems.length === 0}>
        <DashboardGrid items={dashboardItems} onUpdateChange={onUpdateChange} onDelete={onDelete} />
      </EmptyDashboard>
    </SiderLayout>
  );
}
