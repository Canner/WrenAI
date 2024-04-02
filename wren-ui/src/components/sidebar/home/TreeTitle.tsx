import { useState } from 'react';
import styled from 'styled-components';
import { Dropdown, Menu } from 'antd';
import EditOutlined from '@ant-design/icons/EditOutlined';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import LabelTitle from '@/components/sidebar/LabelTitle';
import TreeTitleInput from '@/components/sidebar/home/TreeTitleInput';
import { DeleteThreadModal } from '@/components/modals/DeleteModal';

const MENU_ITEM_KEYS = {
  RENAME: 'rename',
  DELETE: 'delete',
};

const StyledMenu = styled(Menu)`
  a:hover {
    color: white;
  }
`;

export default function TreeTitle(props: {
  threadId: string;
  onDelete: (threadId: string) => void;
  onRename: (threadId: string, newName: string) => void;
  title: string;
}) {
  const { threadId, onDelete, onRename } = props;
  const [title, setTitle] = useState(props.title);
  const [isEditing, setIsEditing] = useState(false);

  const onCancelChange = () => {
    setIsEditing(false);
    setTitle(props.title);
  };

  const onChangeTitle = (newThreadTitle: string) => {
    setIsEditing(false);
    setTitle(newThreadTitle);
    onRename(threadId, newThreadTitle);
  };

  return isEditing ? (
    <TreeTitleInput
      title={title}
      onCancelChange={onCancelChange}
      onSetTitle={setTitle}
      onRename={onChangeTitle}
    />
  ) : (
    <LabelTitle
      title={title}
      appendIcon={
        <Dropdown
          trigger={['click']}
          overlayStyle={{ userSelect: 'none', minWidth: 150 }}
          overlay={
            <StyledMenu
              items={[
                {
                  label: (
                    <>
                      <EditOutlined className="mr-2" />
                      Rename
                    </>
                  ),
                  key: MENU_ITEM_KEYS.RENAME,
                  onClick: ({ domEvent }) => {
                    domEvent.stopPropagation();
                    setIsEditing(true);
                  },
                },
                {
                  label: (
                    <DeleteThreadModal onConfirm={() => onDelete(threadId)} />
                  ),
                  key: MENU_ITEM_KEYS.DELETE,
                  onClick: ({ domEvent }) => {
                    domEvent.stopPropagation();
                  },
                },
              ]}
            />
          }
        >
          <MoreOutlined onClick={(event) => event.stopPropagation()} />
        </Dropdown>
      }
    />
  );
}
