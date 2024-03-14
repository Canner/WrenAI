import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import copy from 'copy-to-clipboard';
import styled from 'styled-components';
import { Button, message } from 'antd';
import { DataNode } from 'antd/es/tree';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import SidebarTree, { useSidebarTreeState } from './SidebarTree';
import { createTreeGroupNode } from '@/components/sidebar/utils';
import { Path } from '@/utils/enum';
import ExplorationTreeTitle from '@/components/sidebar/exploration/ExplorationTreeTitle';

// TODO: update it to real exploration data type
interface ExplorationData {
  id: string;
  name: string;
}

export interface Props {
  data: ExplorationData[];
  onSelect: (selectKeys) => void;
}

const ExplorationSidebarTree = styled(SidebarTree)`
  .adm-treeNode {
    &.adm-treeNode__exploration {
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

export default function Exploration(props: Props) {
  const { data, onSelect } = props;
  const router = useRouter();

  const getExplorationGroupNode = createTreeGroupNode({
    groupName: 'Exploration',
    groupKey: 'exploration',
    icons: [],
  });

  const [tree, setTree] = useState<DataNode[]>(getExplorationGroupNode());
  const { treeSelectedKeys, setTreeSelectedKeys } = useSidebarTreeState();

  useEffect(() => {
    router.query.id && setTreeSelectedKeys([router.query.id] as string[]);
  }, [router.query.id]);

  // initial workspace
  useEffect(() => {
    setTree(
      data.map((exploration) => {
        const nodeKey = exploration.id;

        return {
          className: 'adm-treeNode adm-treeNode__exploration',
          id: nodeKey,
          isLeaf: true,
          key: nodeKey,
          title: (
            <ExplorationTreeTitle
              explorationId={nodeKey}
              title={exploration.name}
              onCopyLink={onCopyLink}
              onRename={(newExplorationName) => {
                // TODO: Call API to rename the exploration result title
                console.log(
                  'Call API to rename the exploration result title:',
                  newExplorationName,
                );
              }}
              onDelete={onDeleteExploration}
            />
          ),
        };
      }),
    );
  }, [data]);

  const onDeleteExploration = (explorationId: string) => {
    // TODO: Call API to delete the exploration result
    console.log('Call delete API:', explorationId);
    if (router.query.id === explorationId) {
      router.push(Path.Exploration);
    }
  };

  const onCopyLink = (explorationId: string) => {
    copy(`${window.location.toString()}/${explorationId}`);
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
          key="add-exploration-result"
          onClick={() => router.push(Path.Exploration)}
          block
        >
          <PlusOutlined />
          New exploration
        </Button>
      </div>
      <ExplorationSidebarTree
        treeData={tree}
        onSelect={onTreeSelect}
        selectedKeys={treeSelectedKeys}
      />
    </>
  );
}
