import styled from 'styled-components';
import SidebarTree from './SidebarTree';
import ModelTree from './modeling/ModelTree';
import MetricTree from './modeling/MetricTree';
import ViewTree from './modeling/ViewTree';
import { AdaptedData } from '@/utils/data';

export const StyledSidebarTree = styled(SidebarTree)`
  .ant-tree-title {
    flex-grow: 1;
    display: inline-flex;
    align-items: center;
    span:first-child,
    .adm-treeTitle__title {
      flex-grow: 1;
    }
  }

  .adm-treeNode {
    .ant-tree-title {
      display: inline-flex;
      flex-wrap: nowrap;
      min-width: 1px;
      flex-grow: 0;
    }
  }
`;

export interface Props {
  data: AdaptedData;
  onOpenModelDrawer: () => void;
  onOpenMetricDrawer: () => void;
  onOpenViewDrawer: () => void;
  onSelect: (selectKeys) => void;
}

export default function Modeling(props: Props) {
  // TODO: get sidebar data
  const {
    data,
    onSelect,
    onOpenModelDrawer,
    onOpenMetricDrawer,
    onOpenViewDrawer,
  } = props;
  const { models = [], metrics = [], views = [] } = data || {};

  return (
    <>
      <ModelTree
        models={models}
        onSelect={onSelect}
        selectedKeys={[]}
        onOpenModelDrawer={onOpenModelDrawer}
      />
      <MetricTree
        metrics={metrics}
        onSelect={onSelect}
        selectedKeys={[]}
        onOpenMetricDrawer={onOpenMetricDrawer}
      />
      <ViewTree
        views={views}
        onSelect={onSelect}
        selectedKeys={[]}
        onOpenViewDrawer={onOpenViewDrawer}
      />
    </>
  );
}
