import { useEffect, useState } from 'react';
import { DataNode } from 'antd/es/tree';
import PlusSquareOutlined from '@ant-design/icons/PlusSquareOutlined';
import { getNodeTypeIcon } from '@/utils/nodeType';
import {
  createTreeGroupNode,
  getColumnNode,
} from '@/components/sidebar/utils';
import LabelTitle from '@/components/sidebar/LabelTitle';
import { StyledSidebarTree } from '@/components/sidebar/Modeling';

export default function ViewTree(props) {
  const { onOpenViewDrawer, views } = props;

  const getViewGroupNode = createTreeGroupNode({
    groupName: 'Views',
    groupKey: 'views',
    icons: [
      {
        key: 'add-view',
        icon: () => <PlusSquareOutlined onClick={() => onOpenViewDrawer()} />,
      },
    ],
  });

  const [tree, setTree] = useState<DataNode[]>(getViewGroupNode());

  // initial workspace
  useEffect(() => {
    setTree((tree) =>
      getViewGroupNode({
        quotaUsage: views.length,
        children: views.map((view) => {
          const nodeKey = view.id || view.name;

          // TODO: remove [] when we have real views data since columns should be required
          const children = getColumnNode(nodeKey, view.columns || []);

          return {
            children,
            className: 'adm-treeNode',
            icon: getNodeTypeIcon({ nodeType: view.nodeType }),
            id: nodeKey,
            isLeaf: false,
            key: nodeKey,
            title: <LabelTitle title={view.displayName} />,
            type: view.nodeType,
          };
        }),
      })
    );
  }, [views]);

  return <StyledSidebarTree {...props} treeData={tree} />;
}
