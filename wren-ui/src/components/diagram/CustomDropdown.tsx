import React from 'react';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
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

type DropdownItem = NonNullable<MenuProps['items']>[number];

interface Props {
  [key: string]: any;
  onMoreClick: (type: MORE_ACTION | { type: MORE_ACTION; data: any }) => void;
  onMenuEnter?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

const makeDropdown =
  (getItems: (props: Props) => DropdownItem[]) => (props: Props) => {
    const { children, onMenuEnter, onOpenChange } = props;

    const items = getItems(props);

    return (
      <Dropdown
        trigger={['click']}
        styles={{ root: { minWidth: 100, userSelect: 'none' } }}
        menu={{
          items,
          onClick: (event) => event.domEvent.stopPropagation(),
          onMouseEnter: onMenuEnter,
        }}
        onOpenChange={onOpenChange}
      >
        {children}
      </Dropdown>
    );
  };

export const ModelDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, disableMutationActions } = props;

  const items: DropdownItem[] = [
    {
      label: (
        <>
          <EditOutlined className="mr-2" />
          更新字段
        </>
      ),
      key: MORE_ACTION.UPDATE_COLUMNS,
      disabled: Boolean(disableMutationActions),
      onClick: () => onMoreClick(MORE_ACTION.UPDATE_COLUMNS),
    },
    {
      label: (
        <DeleteModelModal onConfirm={() => onMoreClick(MORE_ACTION.DELETE)} />
      ),
      className: 'red-5',
      key: MORE_ACTION.DELETE,
      disabled: Boolean(disableMutationActions),
      onClick: ({ domEvent }) => domEvent.stopPropagation(),
    },
  ];

  return items;
});

export const ViewDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, disableMutationActions } = props;
  const items: DropdownItem[] = [
    {
      label: (
        <DeleteViewModal onConfirm={() => onMoreClick(MORE_ACTION.DELETE)} />
      ),
      className: 'red-5',
      key: MORE_ACTION.DELETE,
      disabled: Boolean(disableMutationActions),
      onClick: ({ domEvent }) => domEvent.stopPropagation(),
    },
  ];
  return items;
});

export const ColumnDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, data, disableMutationActions } = props;
  const { nodeType } = data;

  const DeleteColumnModal =
    nodeType === NODE_TYPE.RELATION
      ? DeleteRelationshipModal
      : DeleteCalculatedFieldModal;

  const items: DropdownItem[] = [
    {
      label: (
        <>
          <EditOutlined className="mr-2" />
          编辑
        </>
      ),
      key: MORE_ACTION.EDIT,
      disabled: Boolean(disableMutationActions),
      onClick: () => onMoreClick(MORE_ACTION.EDIT),
    },
    {
      label: (
        <DeleteColumnModal onConfirm={() => onMoreClick(MORE_ACTION.DELETE)} />
      ),
      className: 'red-5',
      key: MORE_ACTION.DELETE,
      disabled: Boolean(disableMutationActions),
      onClick: ({ domEvent }) => domEvent.stopPropagation(),
    },
  ];

  return items;
});

export const DashboardDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, isSupportCached, disableCacheSettings, disableRefresh } =
    props;
  const items: DropdownItem[] = [
    isSupportCached && {
      label: (
        <>
          <DatabaseOutlined className="mr-2" />
          缓存设置
        </>
      ),
      key: MORE_ACTION.CACHE_SETTINGS,
      disabled: Boolean(disableCacheSettings),
      onClick: () => onMoreClick(MORE_ACTION.CACHE_SETTINGS),
    },
    {
      label: (
        <>
          <ReloadOutlined className="mr-2" />
          {isSupportCached ? '刷新全部缓存' : '全部刷新'}
        </>
      ),
      key: MORE_ACTION.REFRESH,
      disabled: Boolean(disableRefresh),
      onClick: () => onMoreClick(MORE_ACTION.REFRESH),
    },
  ].filter(Boolean);
  return items;
});

export const DashboardItemDropdown = makeDropdown((props: Props) => {
  const {
    onMoreClick,
    isHideLegend,
    isSupportCached,
    disableRefresh,
    disableDelete,
  } = props;
  const items: DropdownItem[] = [
    {
      label: isHideLegend ? (
        <>
          <EyeOutlined className="mr-2" />
          显示分类
        </>
      ) : (
        <>
          {<EyeInvisibleOutlined className="mr-2" />}
          隐藏分类
        </>
      ),
      key: MORE_ACTION.HIDE_CATEGORY,
      onClick: () => onMoreClick(MORE_ACTION.HIDE_CATEGORY),
    },
    {
      label: (
        <>
          <ReloadOutlined className="mr-2" />
          {isSupportCached ? '刷新缓存' : '刷新'}
        </>
      ),
      key: MORE_ACTION.REFRESH,
      disabled: Boolean(disableRefresh),
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
      disabled: Boolean(disableDelete),
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
    const { onMoreClick, data, disableEdit, disableDelete } = props;
    const items: DropdownItem[] = [
      {
        label: (
          <>
            <EyeOutlined className="mr-2" />
            查看
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
            编辑
          </>
        ),
        key: MORE_ACTION.EDIT,
        disabled: Boolean(disableEdit),
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
        disabled: Boolean(disableDelete),
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
    const { onMoreClick, data, disableEdit, disableDelete } = props;
    const items: DropdownItem[] = [
      {
        label: (
          <>
            <EyeOutlined className="mr-2" />
            查看
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
            编辑
          </>
        ),
        key: MORE_ACTION.EDIT,
        disabled: Boolean(disableEdit),
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
        disabled: Boolean(disableDelete),
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
    const items: DropdownItem[] = [
      {
        label: '调整步骤',
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
        label: '调整 SQL',
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
