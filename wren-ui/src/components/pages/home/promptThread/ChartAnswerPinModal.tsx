import { useEffect, useRef, useState } from 'react';
import { Button, Input, type InputRef, Modal, Space, Typography } from 'antd';
import PlusOutlined from '@ant-design/icons/PlusOutlined';

export default function ChartAnswerPinModal({
  open,
  submitting,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (dashboardName: string) => void | Promise<void>;
}) {
  const [dashboardName, setDashboardName] = useState('');
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!open) {
      setDashboardName('');
      return;
    }

    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => clearTimeout(timer);
  }, [open]);

  const canSubmit = dashboardName.trim().length > 0 && !submitting;

  return (
    <Modal
      title="新建看板并固定"
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
    >
      <Space orientation="vertical" size={14} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          创建一个新的工作空间看板，并在创建后立即固定当前图表。
        </Typography.Text>
        <Input
          ref={inputRef}
          value={dashboardName}
          disabled={submitting}
          placeholder="输入新看板名称，例如：本周经营复盘"
          onChange={(event) => setDashboardName(event.target.value)}
          onPressEnter={() => {
            if (!canSubmit) {
              return;
            }
            void onSubmit(dashboardName);
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <Button disabled={submitting} onClick={onCancel}>
            取消
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={submitting}
            disabled={!canSubmit}
            onClick={() => {
              void onSubmit(dashboardName);
            }}
          >
            新建并固定
          </Button>
        </div>
      </Space>
    </Modal>
  );
}
