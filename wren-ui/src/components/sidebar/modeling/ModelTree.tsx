import { useEffect, useState } from 'react';
import { DataNode } from 'antd/es/tree';
import { DiagramModel } from '@/utils/data';
import { getNodeTypeIcon } from '@/utils/nodeType';
import { createTreeGroupNode, getColumnNode } from '@/components/sidebar/utils';
import LabelTitle from '@/components/sidebar/LabelTitle';
import { StyledSidebarTree } from '@/components/sidebar/Modeling';

export default function ModelTree(props: {
  [key: string]: any;
  models: DiagramModel[];
}) {
  const { models } = props;

  const getModelGroupNode = createTreeGroupNode({
    groupName: 'Models',
    groupKey: 'models',
    icons: [],
  });

  const [tree, setTree] = useState<DataNode[]>(getModelGroupNode());

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
