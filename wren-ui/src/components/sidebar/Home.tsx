import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, message } from 'antd';
import styled from 'styled-components';
import copy from 'copy-to-clipboard';
import { DataNode } from 'antd/es/tree';
import { Path } from '@/utils/enum';
import { createTreeGroupNode } from '@/components/sidebar/utils';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import SidebarTree, { useSidebarTreeState } from './SidebarTree';
import TreeTitle from '@/components/sidebar/home/TreeTitle';

// TODO: update it to real thread data type
interface ThreadData {
  id: string;
  name: string;
}

export interface Props {
  data: ThreadData[];
  onSelect: (selectKeys) => void;
}

const StyledSidebarTree = styled(SidebarTree)`
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
  const { data, onSelect } = props;
  const router = useRouter();

  const getThreadGroupNode = createTreeGroupNode({
    groupName: 'Thread',
    groupKey: 'thread',
    icons: [],
  });

  const [tree, setTree] = useState<DataNode[]>(getThreadGroupNode());
  const { treeSelectedKeys, setTreeSelectedKeys } = useSidebarTreeState();

  useEffect(() => {
    router.query.id && setTreeSelectedKeys([router.query.id] as string[]);
  }, [router.query.id]);

  // initial workspace
  useEffect(() => {
    setTree(
      data.map((thread) => {
        const nodeKey = thread.id;

        return {
          className: 'adm-treeNode adm-treeNode__thread',
          id: nodeKey,
          isLeaf: true,
          key: nodeKey,
          title: (
            <TreeTitle
              threadId={nodeKey}
              title={thread.name}
              onCopyLink={onCopyLink}
              onRename={(newThreadName) => {
                // TODO: Call API to rename the thread name
                console.log(
                  'Call API to rename the thread name:',
                  newThreadName,
                );
              }}
              onDelete={onDeleteThread}
            />
          ),
        };
      }),
    );
  }, [data]);

  const onDeleteThread = (threadId: string) => {
    // TODO: Call API to delete the thread result
    console.log('Call delete API:', threadId);
    if (router.query.id === threadId) {
      router.push(Path.Home);
    }
  };

  const onCopyLink = (threadId: string) => {
    copy(`${window.location.toString()}/${threadId}`);
    message.success('Copied link to clipboard.');
  };

  const onTreeSelect = (selectedKeys: React.Key[], _info: any) => {
    // prevent deselected
    if (selectedKeys.length === 0) return;

    setTreeSelectedKeys(selectedKeys);
    onSelect(selectedKeys);
  };

  return (
    <>
      <div className="px-4 py-4">
        <Button
          style={{ backgroundColor: 'transparent' }}
          key="add-home-result"
          onClick={() => router.push(Path.Home)}
          block
        >
          <PlusOutlined />
          New thread
        </Button>
      </div>
      <StyledSidebarTree
        treeData={tree}
        onSelect={onTreeSelect}
        selectedKeys={treeSelectedKeys}
      />
    </>
  );
}
