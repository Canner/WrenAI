import { useEffect, useState } from 'react';
import { DataNode } from 'antd/es/tree';
import { startCase } from 'lodash';
import PlusSquareOutlined from '@ant-design/icons/PlusSquareOutlined';
import { getNodeTypeIcon } from '@/utils/nodeType';
import {
  createTreeGroupNode,
  getColumnNode,
} from '@/components/sidebar/utils';
import LabelTitle from '@/components/sidebar/LabelTitle';
import { METRIC_TYPE } from '@/utils/enum';
import { StyledSidebarTree } from '@/components/sidebar/Modeling';

export default function MetricTree(props) {
  const { onOpenMetricDrawer, metrics } = props;

  const getMetricGroupNode = createTreeGroupNode({
    groupName: 'Metrics',
    groupKey: 'metrics',
    icons: [
      {
        key: 'add-metric',
        icon: () => <PlusSquareOutlined onClick={() => onOpenMetricDrawer()} />,
      },
    ],
  });

  const [tree, setTree] = useState<DataNode[]>(getMetricGroupNode());

  // initial workspace
  useEffect(() => {
    setTree((_tree) =>
      getMetricGroupNode({
        quotaUsage: metrics.length,
        children: metrics.map((metric) => {
          const nodeKey = metric.id;

          const children = [
            ...getColumnNode(
              nodeKey,
              [...(metric.dimensions || []), ...(metric.timeGrains || [])],
              startCase(METRIC_TYPE.DIMENSION)
            ),
            ...getColumnNode(
              nodeKey,
              metric.measures || [],
              startCase(METRIC_TYPE.MEASURE)
            ),
            ...getColumnNode(
              nodeKey,
              metric.windows || [],
              startCase(METRIC_TYPE.WINDOW)
            ),
          ];

          return {
            children,
            className: 'adm-treeNode',
            icon: getNodeTypeIcon({ nodeType: metric.nodeType }),
            id: nodeKey,
            isLeaf: false,
            key: nodeKey,
            title: <LabelTitle title={metric.displayName} />,
            type: metric.nodeType,
          };
        }),
      })
    );
  }, [metrics]);

  return <StyledSidebarTree {...props} treeData={tree} />;
}
