import { useMemo } from 'react';
import { useRouter } from 'next/router';
import { useMutation, useQuery } from '@apollo/client';
import { message } from 'antd';
import { Path } from '@/utils/enum';
import {
  useDeleteThreadMutation,
  useThreadsQuery,
  useUpdateThreadMutation,
} from '@/apollo/client/graphql/home.generated';
import {
  CREATE_DASHBOARD,
  DASHBOARDS,
  DELETE_DASHBOARD,
  UPDATE_DASHBOARD,
} from '@/apollo/client/graphql/dashboard';

export default function useHomeSidebar() {
  const router = useRouter();
  const { data, refetch } = useThreadsQuery({
    fetchPolicy: 'network-only',
    nextFetchPolicy: 'network-only',
  });
  const { data: dashboardData, refetch: refetchDashboards } = useQuery(
    DASHBOARDS,
    {
      fetchPolicy: 'network-only',
      nextFetchPolicy: 'network-only',
    },
  );
  const [updateThread] = useUpdateThreadMutation({
    onError: (error) => console.error(error),
  });
  const [deleteThread] = useDeleteThreadMutation({
    onError: (error) => console.error(error),
  });

  const threads = useMemo(
    () =>
      (data?.threads || []).map((thread) => ({
        id: thread.id.toString(),
        name: thread.summary,
      })),
    [data],
  );

  const dashboards = useMemo(
    () =>
      (dashboardData?.dashboards || []).map((dashboard) => ({
        id: dashboard.id.toString(),
        name: dashboard.name,
      })),
    [dashboardData],
  );

  const [createDashboard] = useMutation(CREATE_DASHBOARD, {
    onError: (error) => {
      console.error(error);
      message.error('Failed to create dashboard.');
    },
  });
  const [updateDashboard] = useMutation(UPDATE_DASHBOARD, {
    onError: (error) => {
      console.error(error);
      message.error('Failed to rename dashboard.');
    },
  });
  const [deleteDashboard] = useMutation(DELETE_DASHBOARD, {
    onError: (error) => {
      console.error(error);
      message.error('Failed to delete dashboard.');
    },
  });

  const onSelectThread = (selectKeys: string[]) => {
    router.push(`${Path.Home}/${selectKeys[0]}`);
  };

  const onSelectDashboard = (selectKeys: string[]) => {
    router.push({
      pathname: Path.HomeDashboard,
      query: { dashboardId: selectKeys[0] },
    });
  };

  const onRenameThread = async (id: string, newName: string) => {
    await updateThread({
      variables: { where: { id: Number(id) }, data: { summary: newName } },
    });
    refetch();
  };

  const onDeleteThread = async (id: string) => {
    await deleteThread({ variables: { where: { id: Number(id) } } });
    refetch();
  };

  const onCreateDashboard = async () => {
    const result = await createDashboard({
      variables: { data: {} },
    });
    await refetchDashboards();

    const dashboardId = result.data?.createDashboard?.id;
    if (dashboardId) {
      message.success('Successfully created dashboard.');
      router.push({
        pathname: Path.HomeDashboard,
        query: { dashboardId },
      });
    }
  };

  const onRenameDashboard = async (id: string, newName: string) => {
    await updateDashboard({
      variables: { where: { id: Number(id) }, data: { name: newName } },
    });
    refetchDashboards();
    message.success('Successfully renamed dashboard.');
  };

  const onDeleteDashboard = async (id: string) => {
    const result = await deleteDashboard({
      variables: { where: { id: Number(id) } },
    });
    const nextDashboardId = result.data?.deleteDashboard?.id;
    await refetchDashboards();
    message.success('Successfully deleted dashboard.');

    const currentDashboardId =
      typeof router.query.dashboardId === 'string'
        ? Number(router.query.dashboardId)
        : undefined;

    if (router.pathname === Path.HomeDashboard && currentDashboardId === Number(id)) {
      if (nextDashboardId) {
        router.push({
          pathname: Path.HomeDashboard,
          query: { dashboardId: nextDashboardId },
        });
      } else {
        router.push(Path.Home);
      }
    }
  };

  return {
    data: { dashboards, threads },
    onSelectThread,
    onSelectDashboard,
    onRenameThread,
    onDeleteThread,
    onCreateDashboard,
    onRenameDashboard,
    onDeleteDashboard,
    refetch,
  };
}
