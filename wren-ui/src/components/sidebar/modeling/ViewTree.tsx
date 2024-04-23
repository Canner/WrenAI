import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Modal } from 'antd';
import { DataNode } from 'antd/es/tree';
import PlusSquareOutlined from '@ant-design/icons/PlusSquareOutlined';
import { Path } from '@/utils/enum';
import { DiagramView } from '@/utils/data';
import { getNodeTypeIcon } from '@/utils/nodeType';
import { createTreeGroupNode, getColumnNode } from '@/components/sidebar/utils';
import LabelTitle from '@/components/sidebar/LabelTitle';
import { StyledSidebarTree } from '@/components/sidebar/Modeling';

interface Props {
  [key: string]: any;
  views: DiagramView[];
}

export const createViewInfoModalProps = {
  title: 'How to create a View?',
  content: (
    <div>
      Pose your questions at{' '}
      <Link
        href={Path.Home}
        data-ph-capture="true"
        data-ph-capture-attribute-name="cta_add_view_navigate_to_home"
      >
        homepage
      </Link>
      , and get some helpful answers to save as views.
    </div>
  ),
  okButtonProps: {
    ['data-ph-capture']: true,
    ['data-ph-capture-attribute-name']: 'cta_add_view_ok_btn',
  } as any,
};

export default function ViewTree(props: Props) {
  const { views } = props;

  const getViewGroupNode = createTreeGroupNode({
    groupName: 'Views',
    groupKey: 'views',
    icons: [
      {
        key: 'add-view-info',
        icon: () => (
          <PlusSquareOutlined
            onClick={() => Modal.info(createViewInfoModalProps)}
            data-ph-capture="true"
            data-ph-capture-attribute-name="cta_add_view"
          />
        ),
      },
    ],
  });

  const [tree, setTree] = useState<DataNode[]>(getViewGroupNode());

  useEffect(() => {
    setTree((_tree) =>
      getViewGroupNode({
        quotaUsage: views.length,
        children: views.map((view) => {
          const nodeKey = view.id;
          const children = getColumnNode(nodeKey, view.fields || []);

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
      }),
    );
  }, [views]);

  return <StyledSidebarTree {...props} treeData={tree} />;
}
