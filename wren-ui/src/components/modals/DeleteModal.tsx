import { ReactNode } from 'react';
import { ButtonProps, Modal, ModalProps } from 'antd';
import ExclamationCircleOutlined from '@ant-design/icons/ExclamationCircleOutlined';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';

type DeleteModalProps = {
  disabled?: boolean;
  modalProps?: ModalProps;
  onConfirm: () => void;
  style?: any;
} & Partial<ButtonProps>;

type Config = {
  icon?: ReactNode;
  itemName?: string;
  content?: string;
};

export const makeDeleteModal =
  (Component, config?: Config) => (props: DeleteModalProps) => {
    const { title, content, modalProps = {}, onConfirm, ...restProps } = props;

    return (
      <Component
        icon={config.icon}
        onClick={() =>
          Modal.confirm({
            autoFocusButton: null,
            cancelText: 'Cancel',
            content:
              config?.content ||
              'This will be permanently deleted, please confirm you want to delete it.',
            icon: <ExclamationCircleOutlined />,
            okText: 'Delete',
            onOk: onConfirm,
            title: `Are you sure you want to delete this ${config?.itemName}?`,
            width: 464,
            ...modalProps,
            okButtonProps: {
              ...modalProps.okButtonProps,
              danger: true,
            },
          })
        }
        {...restProps}
      />
    );
  };

const DefaultDeleteButton = (props) => {
  const { icon = null, disabled, ...restProps } = props;
  return (
    <a className={disabled ? '' : 'red-5'} {...restProps}>
      {icon}Delete
    </a>
  );
};

export default makeDeleteModal(DefaultDeleteButton);

// Customize delete modal
export const DeleteThreadModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: 'thread',
  content:
    'This will permanently delete all results history in this thread, please confirm you want to delete it.',
});

export const DeleteViewModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: 'view',
  content:
    'This will be permanently deleted, please confirm you want to delete it.',
});

export const DeleteModelModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: 'model',
  content:
    'This will be permanently deleted, please confirm you want to delete it.',
});

export const DeleteCalculatedFieldModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: 'calculated field',
  content:
    'This will be permanently deleted, please confirm you want to delete it.',
});

export const DeleteRelationshipModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: 'relationship',
  content:
    'This will be permanently deleted, please confirm you want to delete it.',
});

export const DeleteDashboardItemModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: 'dashboard item',
  content:
    'This will be permanently deleted, please confirm you want to delete it.',
});

export const DeleteQuestionSQLPairModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: 'question-SQL pair',
  content:
    'This action is permanent and cannot be undone. Are you sure you want to proceed?',
});
