import styled from 'styled-components';
import SidebarTree from './SidebarTree';
import ModelTree from './modeling/ModelTree';
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
  onSelect: (selectKeys) => void;
}

export default function Modeling(props: Props) {
  const { data, onSelect } = props;
  const { models = [] } = data || {};

  return (
    <>
      <ModelTree models={models} onSelect={onSelect} selectedKeys={[]} />
    </>
  );
}
