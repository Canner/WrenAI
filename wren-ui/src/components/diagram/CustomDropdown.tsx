import { Dropdown, Menu } from 'antd';
import { ItemType } from 'antd/lib/menu/hooks/useItems';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import EditOutlined from '@ant-design/icons/EditOutlined';
import { DeleteViewModal } from '@/components/modals/DeleteModal';

interface Props {
  nodeType: NODE_TYPE;
  onMoreClick: (type: MORE_ACTION) => void;
  children: React.ReactNode;
}

export default function CustomDropdown(props: Props) {
  const { nodeType, onMoreClick, children } = props;
  const isModel = nodeType === NODE_TYPE.MODEL;

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

  if (isModel) {
    items.unshift({
      label: (
        <>
          <EditOutlined className="gray-8 mr-2" />
          Update Columns
        </>
      ),
      key: MORE_ACTION.UPDATE_COLUMNS,
      onClick: () => onMoreClick(MORE_ACTION.UPDATE_COLUMNS),
    });
  }

  return (
    <Dropdown
      trigger={['click']}
      overlayStyle={{ minWidth: 100, userSelect: 'none' }}
      overlay={
        <Menu onClick={(e) => e.domEvent.stopPropagation()} items={items} />
      }
    >
      {children}
    </Dropdown>
  );
}
