import clsx from 'clsx';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useParams } from 'next/navigation';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import FundViewOutlined from '@ant-design/icons/FundViewOutlined';
import SidebarTree, {
  StyledTreeNodeLink,
  useSidebarTreeState,
} from './SidebarTree';
import ThreadTree, { ThreadData } from './home/ThreadTree';

export interface Props {
  data: {
    threads: ThreadData[];
  };
  onSelect: (selectKeys) => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, newName: string) => Promise<void>;
}

export const StyledSidebarTree = styled(SidebarTree)`
  .adm-treeNode {
    &.adm-treeNode__thread {
      padding: 0px 16px 0px 4px !important;

      .ant-tree-title {
        flex-grow: 1;
        display: inline-flex;
        align-items: center;
        span:first-child,
        .adm-treeTitle__title {
          flex-grow: 1;
        }
      }
    }
  }
`;

export default function Home(props: Props) {
  const { data, onSelect, onRename, onDelete } = props;
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { threads } = data;

  const { treeSelectedKeys, setTreeSelectedKeys } = useSidebarTreeState();

  useEffect(() => {
    params?.id && setTreeSelectedKeys([params.id] as string[]);
  }, [params?.id]);

  const onDeleteThread = async (threadId: string) => {
    await onDelete(threadId);
    if (params?.id == threadId) {
      router.push(Path.Home);
    }
  };

  const onTreeSelect = (selectedKeys: React.Key[], _info: any) => {
    // prevent deselected
    if (selectedKeys.length === 0) return;

    setTreeSelectedKeys(selectedKeys);
    onSelect(selectedKeys);
  };

  return (
    <>
      <StyledTreeNodeLink
        className={clsx({
          'adm-treeNode--selected': router.pathname === Path.HomeDashboard,
        })}
        href={Path.HomeDashboard}
      >
        <FundViewOutlined className="mr-2" />
        <span className="text-medium">Dashboard</span>
      </StyledTreeNodeLink>
      <ThreadTree
        threads={threads}
        selectedKeys={treeSelectedKeys}
        onSelect={onTreeSelect}
        onRename={onRename}
        onDeleteThread={onDeleteThread}
      />
    </>
  );
}
