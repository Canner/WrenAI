import { useState } from 'react';
import styled from 'styled-components';
import { Dropdown, Menu } from 'antd';
import EditOutlined from '@ant-design/icons/EditOutlined';
import LinkOutlined from '@ant-design/icons/LinkOutlined';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import LabelTitle from '@/components/sidebar/LabelTitle';
import { DeleteIconModal } from '@/components/modals/DeleteModal';
import ExplorationTitleInput from '@/components/sidebar/exploration/ExplorationTitleInput';

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

export default function ExplorationTreeTitle(props: {
  explorationId: string;
  onCopyLink: (explorationId: string) => void;
  onDelete: (explorationId: string) => void;
  onRename: (newName: string) => void;
  title: string;
}) {
  const { explorationId, onCopyLink, onDelete, onRename } = props;
  const [title, setTitle] = useState(props.title);
  const [isEditing, setIsEditing] = useState(false);

  const onCancelChange = () => {
    setIsEditing(false);
    setTitle(props.title);
  };

  const onChangeTitle = (newExplorationTitle: string) => {
    setIsEditing(false);
    setTitle(newExplorationTitle);
    onRename(newExplorationTitle);
  };

  return isEditing ? (
    <ExplorationTitleInput
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
                    onCopyLink(explorationId);
                  },
                },
                { type: 'divider' },
                {
                  label: (
                    <DeleteIconModal
                      itemName="exploration"
                      onConfirm={() => onDelete(explorationId)}
                    />
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
