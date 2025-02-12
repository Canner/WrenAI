import React from 'react';
import { Dropdown, Menu } from 'antd';
import { ItemType } from 'antd/lib/menu/hooks/useItems';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import EditOutlined from '@ant-design/icons/EditOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import EyeInvisibleOutlined from '@ant-design/icons/EyeInvisibleOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import {
  DeleteCalculatedFieldModal,
  DeleteRelationshipModal,
  DeleteModelModal,
  DeleteViewModal,
  DeleteDashboardItemModal,
} from '@/components/modals/DeleteModal';

interface Props {
  [key: string]: any;
  onMoreClick: (type: MORE_ACTION) => void;
  onMenuEnter?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}

const makeDropdown =
  (getItems: (props: Props) => ItemType[]) => (props: Props) => {
    const { children, onMenuEnter } = props;

    const items = getItems(props);

    return (
      <Dropdown
        trigger={['click']}
        overlayStyle={{ minWidth: 100, userSelect: 'none' }}
        overlay={
          <Menu
            onClick={(e) => e.domEvent.stopPropagation()}
            items={items}
            onMouseEnter={onMenuEnter}
          />
        }
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
          <EditOutlined className="gray-8 mr-2" />
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
          <EditOutlined className="gray-8 mr-2" />
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

export const DashboardItemDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, isHideLegend } = props;
  const items: ItemType[] = [
    {
      label: isHideLegend ? (
        <>
          <EyeOutlined className="gray-8 mr-2" />
          Show categories
        </>
      ) : (
        <>
          {<EyeInvisibleOutlined className="gray-8 mr-2" />}
          Hide categories
        </>
      ),
      key: MORE_ACTION.HIDE_CATEGORY,
      onClick: () => onMoreClick(MORE_ACTION.HIDE_CATEGORY),
    },
    {
      label: (
        <>
          <ReloadOutlined className="gray-8 mr-2" />
          Refresh
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
