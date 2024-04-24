import React from 'react';
import { ReactFlowInstance, useReactFlow } from 'reactflow';
import styled from 'styled-components';
import MarkerHandle from '@/components/diagram/customNode/MarkerHandle';

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

const Title = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--gray-8);
  padding: 4px 12px;
  cursor: default;
`;

type ColumnProps = {
  id: number | string;
  type: string;
  displayName: string;
  style?: React.CSSProperties;
  icon: React.ReactNode;
  extra?: React.ReactNode;
  onMouseEnter?: (reactflowInstance: ReactFlowInstance) => void;
  onMouseLeave?: (reactflowInstance: ReactFlowInstance) => void;
};

type ColumnTitleProps = {
  show: boolean;
  extra?: React.ReactNode;
  children: React.ReactNode;
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
    extra,
  } = props;
  const reactflowInstance = useReactFlow();
  const mouseEnter = onMouseEnter
    ? () => onMouseEnter(reactflowInstance)
    : undefined;
  const mouseLeave = onMouseLeave
    ? () => onMouseLeave(reactflowInstance)
    : undefined;

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
      {extra}
      <MarkerHandle id={id.toString()} />
    </NodeColumn>
  );

  return nodeColumn;
}

const MoreColumnTip = (props: { count: number }) => {
  return <div className="text-sm gray-7 px-3 py-1">and {props.count} more</div>;
};

const ColumnTitle = (props: ColumnTitleProps) => {
  const { show, extra, children } = props;
  if (!show) return null;

  return (
    <Title>
      {children}
      <span>{extra}</span>
    </Title>
  );
};

Column.Title = ColumnTitle;
Column.MoreTip = MoreColumnTip;
