import styled from 'styled-components';
import { hasExecutableRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import SidebarTree, { sidebarCommonStyle } from './SidebarTree';
import ModelTree from './modeling/ModelTree';
import { Diagram, DiagramModel, DiagramView } from '@/utils/data';
import ViewTree from './modeling/ViewTree';

export const StyledSidebarTree = styled(SidebarTree)`
  ${sidebarCommonStyle}

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
  data: Diagram;
  onOpenModelDrawer: () => void;
  onSelect: (selectKeys: React.Key[]) => void;
  readOnly?: boolean;
  onRefresh?: () => Promise<unknown>;
}

export default function Modeling(props: Props) {
  const { data, onSelect, onOpenModelDrawer, readOnly, onRefresh } = props;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const schemaChangeEnabled = hasExecutableRuntimeScopeSelector(
    runtimeScopeNavigation.selector,
  );
  const { models = [], views = [] } = data || {};
  const filteredModels = models.filter(
    (model): model is DiagramModel => model != null,
  );
  const filteredViews = views.filter(
    (view): view is DiagramView => view != null,
  );

  return (
    <>
      <ModelTree
        models={filteredModels}
        onSelect={onSelect}
        selectedKeys={[]}
        onOpenModelDrawer={onOpenModelDrawer}
        readOnly={readOnly}
        schemaChangeEnabled={schemaChangeEnabled}
        onRefresh={onRefresh}
      />
      <ViewTree
        views={filteredViews}
        onSelect={onSelect}
        selectedKeys={[]}
        readOnly={readOnly}
      />
    </>
  );
}
