import { useState } from 'react';
import styled from 'styled-components';
import { Dropdown, Menu } from 'antd';
import EditOutlined from '@ant-design/icons/EditOutlined';
import LinkOutlined from '@ant-design/icons/LinkOutlined';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import LabelTitle from '@/components/sidebar/LabelTitle';
import TreeTitleInput from '@/components/sidebar/home/TreeTitleInput';
import { DeleteThreadModal } from '@/components/modals/DeleteModal';

const MENU_ITEM_KEYS = {
  RENAME: 'rename',
  COPY_LINK: 'copy-link',
  DELETE: 'delete',
};

const StyledMenu = styled(Menu)`
  a:hover {
    color: white;
  }
`;

export default function TreeTitle(props: {
  threadId: string;
  onCopyLink: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onRename: (newName: string) => void;
  title: string;
}) {
  const { threadId, onCopyLink, onDelete, onRename } = props;
  const [title, setTitle] = useState(props.title);
  const [isEditing, setIsEditing] = useState(false);

  const onCancelChange = () => {
    setIsEditing(false);
    setTitle(props.title);
  };

  const onChangeTitle = (newThreadTitle: string) => {
    setIsEditing(false);
    setTitle(newThreadTitle);
    onRename(newThreadTitle);
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
          overlayStyle={{ userSelect: 'none' }}
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
                    <>
                      <LinkOutlined className="mr-2" />
                      Copy link
                    </>
                  ),
                  key: MENU_ITEM_KEYS.COPY_LINK,
                  onClick: ({ domEvent }) => {
                    domEvent.stopPropagation();
                    onCopyLink(threadId);
                  },
                },
                { type: 'divider' },
                {
                  label: (
                    <DeleteThreadModal onConfirm={() => onDelete(threadId)} />
                  ),
                  danger: true,
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
