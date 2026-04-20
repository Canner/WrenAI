import { Input, Modal } from 'antd';

export const DashboardCreateModal = (props: {
  confirmLoading: boolean;
  description: string;
  inputPlaceholder?: string;
  isDashboardReadonly: boolean;
  okText: string;
  open: boolean;
  title: string;
  value: string;
  onCancel: () => void;
  onChangeValue: (value: string) => void;
  onSubmit: () => void;
}) => {
  const {
    confirmLoading,
    description,
    inputPlaceholder,
    isDashboardReadonly,
    okText,
    open,
    title,
    value,
    onCancel,
    onChangeValue,
    onSubmit,
  } = props;

  return (
    <Modal
      title={title}
      visible={open}
      onCancel={onCancel}
      onOk={() => void onSubmit()}
      confirmLoading={confirmLoading}
      okButtonProps={{ disabled: isDashboardReadonly }}
      okText={okText}
      cancelText="取消"
    >
      <div style={{ color: 'var(--nova-text-secondary)', marginBottom: 12 }}>
        {description}
      </div>
      <Input
        autoFocus
        value={value}
        placeholder={inputPlaceholder || '请输入看板名称'}
        onChange={(event) => onChangeValue(event.target.value)}
        onPressEnter={() => void onSubmit()}
      />
    </Modal>
  );
};
