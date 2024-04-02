import { ComposeDiagram } from '@/utils/data';
import { LightningIcon } from '@/utils/icons';
import { Tooltip } from 'antd';
import { NodeProps } from 'reactflow';
import styled from 'styled-components';

export type CustomNodeProps<T> = NodeProps<{
  originalData: T;
  index: number;
  highlight: string[];
}>;

export const StyledNode = styled.div`
  position: relative;
  width: 200px;
  border-radius: 4px;
  overflow: hidden;
  box-shadow:
    0px 3px 6px -4px rgba(0, 0, 0, 0.12),
    0px 6px 16px rgba(0, 0, 0, 0.08),
    0px 9px 28px 8px rgba(0, 0, 0, 0.05);
  cursor: pointer;

  &:before {
    content: '';
    pointer-events: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
    border: 2px solid transparent;
    transition: border-color 0.15s ease-in-out;
  }

  &:hover,
  &:focus {
    &:before {
      border-color: var(--geekblue-6);
    }
  }

  .react-flow__handle {
    border: none;
    opacity: 0;

    &-left {
      left: 0;
    }

    &-right {
      right: 0;
    }
  }
`;

export const NodeHeader = styled.div`
  position: relative;
  background-color: ${(props) => props.color || 'var(--geekblue-6)'};
  font-size: 14px;
  color: white;
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;

  &.dragHandle {
    cursor: move;
  }

  .adm-model-header {
    display: flex;
    align-items: center;

    svg {
      margin-right: 6px;
    }
    + svg {
      cursor: pointer;
    }
  }
`;

export const NodeBody = styled.div`
  background-color: white;
  padding-bottom: 4px;
`;

export const NodeColumn = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  color: var(--gray-9);

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

export const CachedIcon = ({
  originalData,
}: {
  originalData: ComposeDiagram;
}) => {
  return originalData.cached ? (
    <Tooltip
      title={
        <>
          Cached
          {originalData.refreshTime
            ? `: refresh every ${originalData.refreshTime}`
            : null}
        </>
      }
      placement="top"
    >
      <LightningIcon className="cursor-pointer" />
    </Tooltip>
  ) : null;
};
