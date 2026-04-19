import { Modal, Select } from 'antd';
import { type DashboardListItem } from '@/utils/dashboardRest';

type DashboardOption = Pick<DashboardListItem, 'id' | 'name'>;

export default function ChartAnswerPinModal({
  dashboardsLoading,
  dashboardOptions,
  onCancel,
  onConfirm,
  open,
  pinSubmitting,
  pinTargetDashboardId,
  setPinTargetDashboardId,
}: {
  dashboardsLoading: boolean;
  dashboardOptions: DashboardOption[];
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  open: boolean;
  pinSubmitting: boolean;
  pinTargetDashboardId: number | null;
  setPinTargetDashboardId: (value: number | null) => void;
}) {
  return (
    <Modal
      title="固定到看板"
      visible={open}
      onCancel={onCancel}
      confirmLoading={pinSubmitting}
      okText="固定"
      cancelText="取消"
      onOk={onConfirm}
    >
      <div className="gray-7" style={{ marginBottom: 12 }}>
        可选目标看板；如果不选择，将加入当前作用域下的默认看板。固定后，你可以在看板页回到来源线程继续追问。
      </div>
      <Select
        allowClear
        style={{ width: '100%' }}
        placeholder="不指定目标看板"
        loading={dashboardsLoading}
        value={pinTargetDashboardId ?? undefined}
        onChange={(value?: number) => setPinTargetDashboardId(value ?? null)}
        options={dashboardOptions.map((dashboard) => ({
          label: dashboard.name,
          value: dashboard.id,
        }))}
      />
    </Modal>
  );
}
