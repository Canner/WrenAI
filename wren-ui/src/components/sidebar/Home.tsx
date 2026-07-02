import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useParams } from 'next/navigation';
import { Path } from '@/utils/enum';
import { useSidebarTreeState } from './SidebarTree';
import DashboardTree, { DashboardData } from './home/DashboardTree';
import ThreadTree, { ThreadData } from './home/ThreadTree';

export interface Props {
  data: {
    dashboards: DashboardData[];
    threads: ThreadData[];
  };
  onSelectThread: (selectKeys: string[]) => void;
  onSelectDashboard: (selectKeys: string[]) => void;
  onDeleteThread: (id: string) => Promise<void>;
  onRenameThread: (id: string, newName: string) => Promise<void>;
  onCreateDashboard: () => Promise<void>;
  onDeleteDashboard: (id: string) => Promise<void>;
  onRenameDashboard: (id: string, newName: string) => Promise<void>;
}

export default function Home(props: Props) {
  const {
    data,
    onSelectThread,
    onSelectDashboard,
    onRenameThread,
    onDeleteThread: deleteThread,
    onCreateDashboard,
    onDeleteDashboard,
    onRenameDashboard,
  } = props;
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { threads, dashboards } = data;

  const {
    treeSelectedKeys: threadSelectedKeys,
    setTreeSelectedKeys: setThreadSelectedKeys,
  } = useSidebarTreeState();
  const {
    treeSelectedKeys: dashboardSelectedKeys,
    setTreeSelectedKeys: setDashboardSelectedKeys,
  } = useSidebarTreeState();

  useEffect(() => {
    params?.id && setThreadSelectedKeys([params.id] as string[]);
  }, [params?.id]);

  useEffect(() => {
    const selectedDashboardId = router.query.dashboardId;
    if (router.pathname !== Path.HomeDashboard) {
      setDashboardSelectedKeys([]);
      return;
    }

    if (typeof selectedDashboardId === 'string') {
      setDashboardSelectedKeys([selectedDashboardId]);
    }
  }, [router.pathname, router.query.dashboardId]);

  const handleDeleteThread = async (threadId: string) => {
    try {
      await deleteThread(threadId);
      if (params?.id == threadId) {
        router.push(Path.Home);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const onTreeSelect = (selectedKeys: React.Key[], _info: any) => {
    // prevent deselected
    if (selectedKeys.length === 0) return;

    setThreadSelectedKeys(selectedKeys);
    onSelectThread(selectedKeys as string[]);
  };

  const onDashboardSelect = (selectedKeys: React.Key[], _info: any) => {
    if (selectedKeys.length === 0) return;

    setDashboardSelectedKeys(selectedKeys);
    onSelectDashboard(selectedKeys as string[]);
  };

  return (
    <>
      <DashboardTree
        dashboards={dashboards}
        selectedKeys={dashboardSelectedKeys}
        onSelect={onDashboardSelect}
        onRename={onRenameDashboard}
        onDeleteDashboard={onDeleteDashboard}
        onCreateDashboard={onCreateDashboard}
      />
      <ThreadTree
        threads={threads}
        selectedKeys={threadSelectedKeys}
        onSelect={onTreeSelect}
        onRename={onRenameThread}
        onDeleteThread={handleDeleteThread}
      />
    </>
  );
}
