import { ReactFlowInstance, useReactFlow } from 'reactflow';
import styled from 'styled-components';
import MarkerHandle from './MarkerHandle';
import CustomPopover from '../CustomPopover';

const NodeColumn = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  color: var(--gray-9);

  &:hover {
    background-color: var(--gray-3);
  }

  svg {
    cursor: auto;
    flex-shrink: 0;
  }

  .adm-column-title {
    display: flex;
    align-items: center;
    min-width: 1px;
    svg {
      margin-right: 6px;
    }
    > span {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
`;

export const ColumnTitle = styled.div`
  color: var(--gray-8);
  padding: 4px 12px;
  cursor: default;
`;

type ColumnProps = {
  id: string;
  type: string;
  displayName: string;
  properties: {
    [key: string]: any;
    description?: string;
  };
  relation?: any;
  isCalculated?: boolean;
  expression?: string;
  style?: React.CSSProperties;
  icon: React.ReactNode;
  append?: React.ReactNode;
  onMouseEnter?: (reactflowInstance: ReactFlowInstance) => void;
  onMouseLeave?: (reactflowInstance: ReactFlowInstance) => void;
};
export default function Column(props: ColumnProps) {
  const {
    id,
    type,
    onMouseEnter,
    onMouseLeave,
    displayName,
    style = {},
    icon,
    append,
    properties,
    relation,
    isCalculated,
    expression,
  } = props;
  const reactflowInstance = useReactFlow();
  const mouseEnter = onMouseEnter
    ? () => onMouseEnter(reactflowInstance)
    : undefined;
  const mouseLeave = onMouseLeave
    ? () => onMouseLeave(reactflowInstance)
    : undefined;

  const isPopoverShow = !relation;

  const nodeColumn = (
    <NodeColumn
      style={style}
      onMouseEnter={mouseEnter}
      onMouseLeave={mouseLeave}
    >
      <div className="adm-column-title">
        <span title={type}>{icon}</span>
        <span title={displayName}>{displayName}</span>
      </div>
      {append}
      <MarkerHandle id={id} />
    </NodeColumn>
  );

  return isPopoverShow ? (
    <CustomPopover
      title={displayName}
      placement="right"
      content={
        <CustomPopover.Row gutter={16}>
          <CustomPopover.Col title="Description">
            {properties?.description || '-'}
          </CustomPopover.Col>
          {isCalculated && (
            <CustomPopover.Col title="Expression" code>
              {expression}
            </CustomPopover.Col>
          )}
        </CustomPopover.Row>
      }
    >
      {nodeColumn}
    </CustomPopover>
  ) : (
    nodeColumn
  );
}
