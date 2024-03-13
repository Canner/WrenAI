import { Dropdown, Menu } from 'antd';
import { MORE_ACTION } from '@/utils/enum';

interface Props {
  onMoreClick: (type: MORE_ACTION) => void;
  children: React.ReactNode;
}

export default function CustomDropdown(props: Props) {
  const { onMoreClick, children } = props;
  return (
    <Dropdown
      trigger={['click']}
      overlayStyle={{ minWidth: 100, userSelect: 'none' }}
      overlay={
        <Menu
          onClick={(e) => e.domEvent.stopPropagation()}
          items={[
            {
              label: 'Edit',
              key: MORE_ACTION.EDIT,
              onClick: () => onMoreClick(MORE_ACTION.EDIT),
            },
            {
              label: 'Delete',
              className: 'red-5',
              key: MORE_ACTION.DELETE,
              onClick: () => onMoreClick(MORE_ACTION.DELETE),
            },
          ]}
        />
      }
    >
      {children}
    </Dropdown>
  );
}
