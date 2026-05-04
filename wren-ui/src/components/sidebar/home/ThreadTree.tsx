import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { DataNode } from 'antd/lib/tree';
import { Path } from '@/utils/enum';
import { useParams, useRouter } from 'next/navigation';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import SidebarTree, {
  sidebarCommonStyle,
} from '@/components/sidebar/SidebarTree';
import {
  createTreeGroupNode,
  GroupActionButton,
} from '@/components/sidebar/utils';
import TreeTitle from './TreeTitle';

const StyledSidebarTree = styled(SidebarTree)`
  ${sidebarCommonStyle}

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

export interface ThreadData {
  id: string;
  name: string;
}

interface Props {
  threads: ThreadData[];
  selectedKeys: React.Key[];
  onSelect: (selectKeys: React.Key[], info: any) => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
}

export default function ThreadTree(props: Props) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const {
    threads = [],
    selectedKeys,
    onSelect,
    onRename,
    onDeleteThread,
  } = props;

  const getThreadGroupNode = createTreeGroupNode({
    groupName: 'Threads',
    groupKey: 'threads',
    actions: [
      {
        key: 'new-thread',
        render: () => (
          <GroupActionButton
            size="small"
            icon={<PlusOutlined />}
            onClick={() => router.push(Path.Home)}
          >
            New
          </GroupActionButton>
        ),
      },
    ],
  });

  const [tree, setTree] = useState<DataNode[]>(getThreadGroupNode());

  useEffect(() => {
    setTree((_tree) =>
      getThreadGroupNode({
        quotaUsage: threads.length,
        children: threads.map((thread) => {
          const nodeKey = thread.id;

          return {
            className: 'adm-treeNode adm-treeNode__thread',
            id: nodeKey,
            isLeaf: true,
            key: nodeKey,
            title: (
              <TreeTitle
                id={nodeKey}
                title={thread.name}
                onRename={onRename}
                onDelete={onDeleteThread}
              />
            ),
          };
        }),
      }),
    );
  }, [params?.id, threads]);

  return (
    <StyledSidebarTree
      treeData={tree}
      selectedKeys={selectedKeys}
      onSelect={onSelect}
    />
  );
}
