import { ReactNode } from 'react';
import { ButtonProps, ModalProps } from 'antd';
import ExclamationCircleOutlined from '@ant-design/icons/ExclamationCircleOutlined';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import { appModal } from '@/utils/antdAppBridge';

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

type DeleteTriggerProps = {
  icon?: ReactNode;
  onClick?: ButtonProps['onClick'];
} & Omit<Partial<ButtonProps>, 'onClick' | 'icon'>;

export const makeDeleteModal =
  (Component: React.ComponentType<DeleteTriggerProps>, config?: Config) =>
  (props: DeleteModalProps) => {
    const { title, content, modalProps = {}, onConfirm, ...restProps } = props;
    const { width, ...restModalProps } = modalProps;

    return (
      <Component
        icon={config?.icon}
        onClick={() =>
          appModal.confirm({
            autoFocusButton: null,
            cancelText: '取消',
            content: config?.content || '删除后将无法恢复，请确认是否继续。',
            icon: <ExclamationCircleOutlined />,
            okText: '删除',
            onOk: onConfirm,
            title: `确认删除${config?.itemName || '当前内容'}吗？`,
            ...restModalProps,
            width: typeof width === 'object' ? 464 : (width ?? 464),
            okButtonProps: {
              ...restModalProps.okButtonProps,
              danger: true,
            },
          })
        }
        {...restProps}
      />
    );
  };

const DefaultDeleteButton = (props: DeleteTriggerProps) => {
  const { icon = null, disabled, ...restProps } = props;
  return (
    <a className={disabled ? '' : 'red-5'} {...restProps}>
      {icon}删除
    </a>
  );
};

export default makeDeleteModal(DefaultDeleteButton);

// Customize delete modal
export const DeleteThreadModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '当前对话',
  content: '删除后会永久清空当前对话中的全部结果历史，请确认是否继续。',
});

export const DeleteViewModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '视图',
  content: '删除后将无法恢复，请确认是否继续。',
});

export const DeleteModelModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '模型',
  content: '删除后将无法恢复，请确认是否继续。',
});

export const DeleteCalculatedFieldModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '计算字段',
  content: '删除后将无法恢复，请确认是否继续。',
});

export const DeleteRelationshipModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '关系',
  content: '删除后将无法恢复，请确认是否继续。',
});

export const DeleteDashboardItemModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '看板卡片',
  content: '删除后将无法恢复，请确认是否继续。',
});

export const DeleteQuestionSQLPairModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: 'SQL 模板',
  content: '该操作不可撤销，请确认是否继续。',
});

export const DeleteInstructionModal = makeDeleteModal(DefaultDeleteButton, {
  icon: <DeleteOutlined className="mr-2" />,
  itemName: '分析规则',
  content: '该操作不可撤销，请确认是否继续。',
});
