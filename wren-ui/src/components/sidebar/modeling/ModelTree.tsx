import { useEffect, useState } from 'react';
import { DataNode } from 'antd/es/tree';
import PlusSquareOutlined from '@ant-design/icons/PlusSquareOutlined';
import { getNodeTypeIcon } from '@/utils/nodeType';
import { createTreeGroupNode, getColumnNode } from '@/components/sidebar/utils';
import LabelTitle from '@/components/sidebar/LabelTitle';
import { StyledSidebarTree } from '@/components/sidebar/Modeling';

export default function ModelTree(props) {
  const { onOpenModelDrawer, models } = props;

  const getModelGroupNode = createTreeGroupNode({
    groupName: 'Models',
    groupKey: 'models',
    icons: [
      {
        key: 'add-model',
        icon: () => <PlusSquareOutlined onClick={() => onOpenModelDrawer()} />,
      },
    ],
  });

  const [tree, setTree] = useState<DataNode[]>(getModelGroupNode());

  // initial workspace
  useEffect(() => {
    setTree((_tree) =>
      getModelGroupNode({
        quotaUsage: models.length,
        children: models.map((model) => {
          const nodeKey = model.id;

          const children = getColumnNode(nodeKey, model.fields);

          return {
            children,
            className: 'adm-treeNode',
            icon: getNodeTypeIcon({ nodeType: model.nodeType }),
            id: nodeKey,
            isLeaf: false,
            key: nodeKey,
            title: <LabelTitle title={model.displayName} />,
            type: model.nodeType,
          };
        }),
      }),
    );
  }, [models]);

  return <StyledSidebarTree {...props} treeData={tree} />;
}
