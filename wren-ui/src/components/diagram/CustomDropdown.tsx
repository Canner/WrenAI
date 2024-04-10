import { Dropdown, Menu } from 'antd';
import { MORE_ACTION } from '@/utils/enum';
import { DeleteViewModal } from '@/components/modals/DeleteModal';

interface Props {
  onMoreClick: (type: MORE_ACTION) => void;
  children: React.ReactNode;
}

export default function CustomDropdown(props: Props) {
  const { onMoreClick, children } = props;

  return (
    <Dropdown
      trigger={['click']}
      getPopupContainer={(trigger) => trigger.parentElement!}
      overlayStyle={{ minWidth: 100, userSelect: 'none' }}
      overlay={
        <Menu
          onClick={(e) => e.domEvent.stopPropagation()}
          items={[
            {
              label: (
                <DeleteViewModal
                  onConfirm={() => onMoreClick(MORE_ACTION.DELETE)}
                />
              ),
              className: 'red-5',
              key: MORE_ACTION.DELETE,
              onClick: ({ domEvent }) => domEvent.stopPropagation(),
            },
          ]}
        />
      }
    >
      {children}
    </Dropdown>
  );
}
