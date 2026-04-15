import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Modal } from 'antd';
import { DataNode } from 'antd/es/tree';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import { Path } from '@/utils/enum';
import { DiagramView } from '@/utils/data';
import { getNodeTypeIcon } from '@/utils/nodeType';
import {
  createTreeGroupNode,
  getColumnNode,
  GroupActionButton,
} from '@/components/sidebar/utils';
import LabelTitle from '@/components/sidebar/LabelTitle';
import { StyledSidebarTree } from '@/components/sidebar/Modeling';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

interface Props {
  [key: string]: any;
  views: DiagramView[];
  readOnly?: boolean;
}

export default function ViewTree(props: Props) {
  const { views, readOnly = false } = props;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  const onAddView = () => {
    Modal.info({
      title: '如何创建视图？',
      content: (
        <div>
          请先前往
          <Link
            href={runtimeScopeNavigation.hrefWorkspace(Path.Home)}
            data-ph-capture="true"
            data-ph-capture-attribute-name="cta_add_view_navigate_to_home"
          >
            首页
          </Link>
          提问，并将有价值的结果保存为视图。
        </div>
      ),
      okButtonProps: {
        ['data-ph-capture']: true,
        ['data-ph-capture-attribute-name']: 'cta_add_view_ok_btn',
      } as any,
    });
  };

  const getViewGroupNode = createTreeGroupNode({
    groupName: '视图',
    groupKey: 'views',
    emptyLabel: '暂无视图',
    actions: [
      {
        key: 'add-view-info',
        render: () => (
          <GroupActionButton
            icon={<PlusOutlined />}
            size="small"
            disabled={readOnly}
            onClick={onAddView}
            data-ph-capture="true"
            data-ph-capture-attribute-name="cta_add_view"
          >
            新增
          </GroupActionButton>
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
          const viewFields = (view.fields || []).filter(
            (field): field is NonNullable<(typeof view.fields)[number]> =>
              field != null,
          );
          const children = getColumnNode(nodeKey, viewFields);

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
