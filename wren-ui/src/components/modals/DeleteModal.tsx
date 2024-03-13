import React from 'react';
import { ButtonProps, Modal, ModalProps } from 'antd';
import ExclamationCircleOutlined from '@ant-design/icons/ExclamationCircleOutlined';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';

type DeleteModalProps = {
  disabled?: boolean;
  itemName: string;
  modalProps?: ModalProps;
  onConfirm: () => void;
  style?: any;
} & Partial<ButtonProps>;

export const makeDeleteModal = (Component) => (props: DeleteModalProps) => {
  const { itemName = '', modalProps = {}, onConfirm, ...restProps } = props;

  return (
    <Component
      onClick={() =>
        Modal.confirm({
          autoFocusButton: null,
          cancelText: 'Cancel',
          content:
            'This will be permanently deleted, please confirm you want to delete it.',
          icon: <ExclamationCircleOutlined />,
          okText: 'Delete',
          onOk: onConfirm,
          title: `Are you sure you want to delete this ${itemName}?`,
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

const DefaultDelete = (props) => (
  <a
    style={{
      color: props.disabled ? 'var(--disabled)' : 'var(--red-5)',
    }}
    {...props}
  >
    Delete
  </a>
);

const DeleteIconButton = (props) => (
  <a {...props}>
    <DeleteOutlined className="mr-2" />
    Delete
  </a>
);

const DeleteModal = makeDeleteModal(DefaultDelete);
export default DeleteModal;

export const DeleteIconModal = makeDeleteModal(DeleteIconButton);
