import Link from 'next/link';
import { useState } from 'react';
import styled, { css } from 'styled-components';
import { Tree, TreeProps } from 'antd';

const anticonStyle = css`
  [class^='anticon anticon-'] {
    transition: background-color ease-out 0.12s;
    border-radius: 2px;
    width: 12px;
    height: 12px;
    font-size: 12px;
    vertical-align: middle;

    &:hover {
      background-color: var(--gray-5);
    }
    &:active {
      background-color: var(--gray-6);
    }

    &[disabled] {
      cursor: not-allowed;
      color: var(--gray-6);
      &:hover,
      &:active {
        background-color: transparent;
      }
    }
  }
  .anticon + .anticon {
    margin-left: 4px;
  }
`;

const StyledTree = styled(Tree)`
  &.ant-tree {
    background-color: transparent;
    color: var(--gray-8);

    .ant-tree-indent-unit {
      width: 12px;
    }

    .ant-tree-node-content-wrapper {
      display: flex;
      align-items: center;
      line-height: 18px;
      min-height: 28px;
      min-width: 1px;
      padding: 0;
    }

    .ant-tree-node-content-wrapper:hover,
    .ant-tree-node-content-wrapper.ant-tree-node-selected {
      background-color: transparent;
    }

    .ant-tree-treenode {
      padding: 0 16px;
      background-color: transparent;
      transition: background-color ease-out 0.12s;

      &-selected {
        color: var(--geekblue-6);
        background-color: var(--gray-4);
      }

      .ant-tree-switcher {
        width: 12px;
        align-self: center;
        .ant-tree-switcher-icon {
          font-size: 12px;
          vertical-align: middle;
        }
        ${anticonStyle}
      }

      .ant-tree-iconEle {
        flex-shrink: 0;
      }
    }

    .adm {
      &-treeTitle__title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &-treeNode {
        &:hover {
          background-color: var(--gray-4);
        }
        &:active {
          background-color: var(--gray-6);
        }

        .ant-tree-title {
          display: inline-flex;
          flex-wrap: nowrap;
          min-width: 1px;
        }

        &--relation,
        &--primary {
          margin-left: 4px;
        }

        &--group {
          color: var(--gray-8);
          margin-top: 16px;

          font-size: 14px;
          font-weight: 500;

          .ant-tree-switcher-noop {
            display: none;
          }

          > * {
            cursor: inherit;
          }
        }

        &--empty {
          color: var(--gray-7);
          font-size: 12px;
          .ant-tree-switcher {
            display: none;
          }
          .ant-tree-node-content-wrapper {
            min-height: auto;
          }
        }

        &--selectNode {
          * {
            cursor: auto;
          }
          &:hover,
          &:active {
            background-color: transparent;
          }
        }

        &--subtitle {
          color: var(--gray-7);
          font-size: 12px;
          font-weight: 500;
          .ant-tree-switcher {
            display: none;
          }
          .ant-tree-node-content-wrapper {
            min-height: auto;
          }
        }

        &--selectNone {
          * {
            cursor: auto;
          }
          &:hover,
          &:active {
            background-color: transparent;
          }
        }
      }

      &-actionIcon {
        font-size: 14px;
        border-radius: 2px;
        margin-right: -3px;
        &:not(.adm-actionIcon--disabled) {
          cursor: pointer;
          &:hover {
            background-color: var(--gray-5);
          }
        }
        .anticon {
          padding: 2px;
          cursor: inherit;
        }
        &--disabled {
          color: var(--gray-6);
          cursor: not-allowed;
        }
      }
    }
  }
`;

export const sidebarCommonStyle = css`
  .ant-tree-title {
    flex-grow: 1;
    display: inline-flex;
    align-items: center;
    span:first-child,
    .adm-treeTitle__title {
      flex-grow: 1;
    }
  }
`;

export const StyledTreeNodeLink = styled(Link)`
  display: block;
  cursor: pointer;
  user-select: none;
  margin-top: 16px;
  padding: 0 16px;
  line-height: 28px;
  color: var(--gray-8);
  &:hover {
    background-color: var(--gray-4);
  }
  &:active {
    background-color: var(--gray-6);
  }
  &.adm-treeNode--selected {
    background-color: var(--gray-4);
    color: var(--geekblue-6);
  }
`;

export const useSidebarTreeState = () => {
  const [treeSelectedKeys, setTreeSelectedKeys] = useState<React.Key[]>([]);
  const [treeExpandKeys, setTreeExpandKeys] = useState<React.Key[]>([]);
  const [treeLoadedKeys, setTreeLoadedKeys] = useState<React.Key[]>([]);
  const [autoExpandParent, setAutoExpandParent] = useState(true);

  return {
    treeSelectedKeys,
    treeExpandKeys,
    treeLoadedKeys,
    autoExpandParent,
    setTreeSelectedKeys,
    setTreeExpandKeys,
    setTreeLoadedKeys,
    setAutoExpandParent,
  };
};

export default function SidebarTree(props: TreeProps) {
  return (
    <StyledTree
      blockNode
      showIcon
      motion={null} // https://github.com/ant-design/ant-design/issues/16943#issuecomment-859966751
      {...props}
    />
  );
}
