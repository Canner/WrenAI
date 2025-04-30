import React from 'react';
import styled from 'styled-components';
import { Dropdown, Menu } from 'antd';
import { ItemType } from 'antd/lib/menu/hooks/useItems';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import EditOutlined from '@ant-design/icons/EditOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import EyeInvisibleOutlined from '@ant-design/icons/EyeInvisibleOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import CodeFilled from '@ant-design/icons/CodeFilled';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import { EditSVG } from '@/utils/svgs';
import {
  DeleteCalculatedFieldModal,
  DeleteRelationshipModal,
  DeleteModelModal,
  DeleteViewModal,
  DeleteDashboardItemModal,
  DeleteQuestionSQLPairModal,
  DeleteInstructionModal,
} from '@/components/modals/DeleteModal';

const StyledMenu = styled(Menu)`
  .ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled) {
    color: var(--gray-8);
  }
`;

interface Props {
  [key: string]: any;
  onMoreClick: (type: MORE_ACTION | { type: MORE_ACTION; data: any }) => void;
  onMenuEnter?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
  onDropdownVisibleChange?: (visible: boolean) => void;
}

const makeDropdown =
  (getItems: (props: Props) => ItemType[]) => (props: Props) => {
    const { children, onMenuEnter, onDropdownVisibleChange } = props;

    const items = getItems(props);

    return (
      <Dropdown
        trigger={['click']}
        overlayStyle={{ minWidth: 100, userSelect: 'none' }}
        overlay={
          <StyledMenu
            onClick={(e) => e.domEvent.stopPropagation()}
            items={items}
            onMouseEnter={onMenuEnter}
          />
        }
        onVisibleChange={onDropdownVisibleChange}
      >
        {children}
      </Dropdown>
    );
  };

export const ModelDropdown = makeDropdown((props: Props) => {
  const { onMoreClick } = props;

  const items: ItemType[] = [
    {
      label: (
        <>
          <EditOutlined className="mr-2" />
          Update Columns
        </>
      ),
      key: MORE_ACTION.UPDATE_COLUMNS,
      onClick: () => onMoreClick(MORE_ACTION.UPDATE_COLUMNS),
    },
    {
      label: (
        <DeleteModelModal onConfirm={() => onMoreClick(MORE_ACTION.DELETE)} />
      ),
      className: 'red-5',
      key: MORE_ACTION.DELETE,
      onClick: ({ domEvent }) => domEvent.stopPropagation(),
    },
  ];

  return items;
});

export const ViewDropdown = makeDropdown((props: Props) => {
  const { onMoreClick } = props;
  const items: ItemType[] = [
    {
      label: (
        <DeleteViewModal onConfirm={() => onMoreClick(MORE_ACTION.DELETE)} />
      ),
      className: 'red-5',
      key: MORE_ACTION.DELETE,
      onClick: ({ domEvent }) => domEvent.stopPropagation(),
    },
  ];
  return items;
});

export const ColumnDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, data } = props;
  const { nodeType } = data;

  const DeleteColumnModal =
    {
      [NODE_TYPE.CALCULATED_FIELD]: DeleteCalculatedFieldModal,
      [NODE_TYPE.RELATION]: DeleteRelationshipModal,
    }[nodeType] || DeleteCalculatedFieldModal;

  const items: ItemType[] = [
    {
      label: (
        <>
          <EditOutlined className="mr-2" />
          Edit
        </>
      ),
      key: MORE_ACTION.EDIT,
      onClick: () => onMoreClick(MORE_ACTION.EDIT),
    },
    {
      label: (
        <DeleteColumnModal onConfirm={() => onMoreClick(MORE_ACTION.DELETE)} />
      ),
      className: 'red-5',
      key: MORE_ACTION.DELETE,
      onClick: ({ domEvent }) => domEvent.stopPropagation(),
    },
  ];

  return items;
});

export const DashboardDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, isSupportCached } = props;
  const items: ItemType[] = [
    isSupportCached && {
      label: (
        <>
          <DatabaseOutlined className="mr-2" />
          Cache settings
        </>
      ),
      key: MORE_ACTION.CACHE_SETTINGS,
      onClick: () => onMoreClick(MORE_ACTION.CACHE_SETTINGS),
    },
    {
      label: (
        <>
          <ReloadOutlined className="mr-2" />
          {isSupportCached ? 'Refresh all caches' : 'Refresh all'}
        </>
      ),
      key: MORE_ACTION.REFRESH,
      onClick: () => onMoreClick(MORE_ACTION.REFRESH),
    },
  ].filter(Boolean);
  return items;
});

export const DashboardItemDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, isHideLegend, isSupportCached } = props;
  const items: ItemType[] = [
    {
      label: isHideLegend ? (
        <>
          <EyeOutlined className="mr-2" />
          Show categories
        </>
      ) : (
        <>
          {<EyeInvisibleOutlined className="mr-2" />}
          Hide categories
        </>
      ),
      key: MORE_ACTION.HIDE_CATEGORY,
      onClick: () => onMoreClick(MORE_ACTION.HIDE_CATEGORY),
    },
    {
      label: (
        <>
          <ReloadOutlined className="mr-2" />
          {isSupportCached ? 'Refresh cache' : 'Refresh'}
        </>
      ),
      key: MORE_ACTION.REFRESH,
      onClick: () => onMoreClick(MORE_ACTION.REFRESH),
    },
    {
      label: (
        <DeleteDashboardItemModal
          onConfirm={() => onMoreClick(MORE_ACTION.DELETE)}
        />
      ),
      className: 'red-5',
      key: MORE_ACTION.DELETE,
      onClick: ({ domEvent }) => domEvent.stopPropagation(),
    },
  ];
  return items;
});

export const SQLPairDropdown = makeDropdown(
  (
    props: Props & {
      onMoreClick: (payload: { type: MORE_ACTION; data: any }) => void;
    },
  ) => {
    const { onMoreClick, data } = props;
    const items: ItemType[] = [
      {
        label: (
          <>
            <EyeOutlined className="mr-2" />
            View
          </>
        ),
        key: MORE_ACTION.VIEW_SQL_PAIR,
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.VIEW_SQL_PAIR,
            data,
          }),
      },
      {
        label: (
          <>
            <EditOutlined className="mr-2" />
            Edit
          </>
        ),
        key: MORE_ACTION.EDIT,
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.EDIT,
            data,
          }),
      },
      {
        label: (
          <DeleteQuestionSQLPairModal
            onConfirm={() =>
              onMoreClick({
                type: MORE_ACTION.DELETE,
                data,
              })
            }
            modalProps={{
              cancelButtonProps: { autoFocus: true },
            }}
          />
        ),
        className: 'red-5',
        key: MORE_ACTION.DELETE,
        onClick: ({ domEvent }) => domEvent.stopPropagation(),
      },
    ];
    return items;
  },
);

export const InstructionDropdown = makeDropdown(
  (
    props: Props & {
      onMoreClick: (payload: { type: MORE_ACTION; data: any }) => void;
    },
  ) => {
    const { onMoreClick, data } = props;
    const items: ItemType[] = [
      {
        label: (
          <>
            <EyeOutlined className="mr-2" />
            View
          </>
        ),
        key: MORE_ACTION.VIEW_INSTRUCTION,
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.VIEW_INSTRUCTION,
            data,
          }),
      },
      {
        label: (
          <>
            <EditOutlined className="mr-2" />
            Edit
          </>
        ),
        key: MORE_ACTION.EDIT,
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.EDIT,
            data,
          }),
      },
      {
        label: (
          <DeleteInstructionModal
            onConfirm={() =>
              onMoreClick({
                type: MORE_ACTION.DELETE,
                data,
              })
            }
            modalProps={{
              cancelButtonProps: { autoFocus: true },
            }}
          />
        ),
        className: 'red-5',
        key: MORE_ACTION.DELETE,
        onClick: ({ domEvent }) => domEvent.stopPropagation(),
      },
    ];
    return items;
  },
);

export const AdjustAnswerDropdown = makeDropdown(
  (
    props: Props & {
      onMoreClick: (payload: { type: MORE_ACTION; data: any }) => void;
    },
  ) => {
    const { onMoreClick, data } = props;
    const items: ItemType[] = [
      {
        label: 'Adjust steps',
        icon: <EditSVG />,
        disabled: !data.sqlGenerationReasoning,
        key: 'adjust-steps',
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.ADJUST_STEPS,
            data,
          }),
      },
      {
        label: 'Adjust SQL',
        icon: <CodeFilled className="text-base" />,
        disabled: !data.sql,
        key: 'adjust-sql',
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.ADJUST_SQL,
            data,
          }),
      },
    ];
    return items;
  },
);
