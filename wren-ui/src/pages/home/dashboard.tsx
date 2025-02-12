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
    onCompleted: () => {
      message.success('Successfully deleted dashboard item.');
      refetch();
    },
  });

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
      <EmptyDashboard show={dashboardItems.length === 0}>
        <DashboardGrid
          items={dashboardItems}
          onUpdateChange={onUpdateChange}
          onDelete={onDelete}
        />
      </EmptyDashboard>
    </SiderLayout>
  );
}
