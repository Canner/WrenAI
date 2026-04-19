import { Input, Modal } from 'antd';

export const DashboardCreateModal = (props: {
  createDashboardLoading: boolean;
  createDashboardName: string;
  isDashboardReadonly: boolean;
  open: boolean;
  onCancel: () => void;
  onChangeName: (value: string) => void;
  onSubmit: () => void;
}) => {
  const {
    createDashboardLoading,
    createDashboardName,
    isDashboardReadonly,
    open,
    onCancel,
    onChangeName,
    onSubmit,
  } = props;

  return (
    <Modal
      title="新建看板"
      visible={open}
      onCancel={onCancel}
      onOk={() => void onSubmit()}
      confirmLoading={createDashboardLoading}
      okButtonProps={{ disabled: isDashboardReadonly }}
      okText="创建看板"
      cancelText="取消"
    >
      <div style={{ color: 'var(--nova-text-secondary)', marginBottom: 12 }}>
        为当前工作空间新增一个可承接图表结果的数据看板。
      </div>
      <Input
        autoFocus
        value={createDashboardName}
        placeholder="例如：经营总览 / 销售日报"
        onChange={(event) => onChangeName(event.target.value)}
        onPressEnter={() => void onSubmit()}
      />
    </Modal>
  );
};
