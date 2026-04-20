import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Divider,
  Empty,
  Input,
  type InputRef,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import {
  resolveDashboardDisplayName,
  type DashboardListItem,
} from '@/utils/dashboardRest';

type DashboardOption = Pick<
  DashboardListItem,
  'id' | 'isDefault' | 'name' | 'cacheEnabled' | 'scheduleFrequency'
>;

export default function ChartAnswerPinModal({
  createAndPinSubmitting,
  dashboardsLoading,
  dashboardOptions,
  onCancel,
  onConfirm,
  onCreateAndPin,
  open,
  pinSubmitting,
  pinTargetDashboardId,
  setPinTargetDashboardId,
}: {
  createAndPinSubmitting: boolean;
  dashboardsLoading: boolean;
  dashboardOptions: DashboardOption[];
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  onCreateAndPin: (dashboardName: string) => void | Promise<void>;
  open: boolean;
  pinSubmitting: boolean;
  pinTargetDashboardId: number | null;
  setPinTargetDashboardId: (value: number | null) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [createDashboardName, setCreateDashboardName] = useState('');
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const createDashboardInputRef = useRef<InputRef>(null);

  const defaultDashboardOption = useMemo(
    () =>
      dashboardOptions.find((dashboard) => dashboard.isDefault) ||
      dashboardOptions[0] ||
      null,
    [dashboardOptions],
  );

  useEffect(() => {
    if (!open) {
      setKeyword('');
      setCreateDashboardName('');
      setCreateFormOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !createFormOpen || createAndPinSubmitting) {
      return;
    }

    const timer = setTimeout(() => {
      createDashboardInputRef.current?.focus();
    }, 0);

    return () => clearTimeout(timer);
  }, [createAndPinSubmitting, createFormOpen, open]);

  const filteredDashboardOptions = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return dashboardOptions;
    }

    return dashboardOptions.filter((dashboard) =>
      `${resolveDashboardDisplayName(dashboard.name)} ${
        dashboard.scheduleFrequency || ''
      }`
        .toLowerCase()
        .includes(normalizedKeyword),
    );
  }, [dashboardOptions, keyword]);

  const canSubmitCreateAndPin =
    createDashboardName.trim().length > 0 &&
    !pinSubmitting &&
    !createAndPinSubmitting;

  return (
    <Modal
      title="固定到看板"
      open={open}
      width={640}
      onCancel={onCancel}
      confirmLoading={pinSubmitting}
      okButtonProps={{ disabled: createAndPinSubmitting }}
      cancelButtonProps={{ disabled: pinSubmitting || createAndPinSubmitting }}
      okText="固定"
      cancelText="取消"
      onOk={onConfirm}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          选择当前工作空间里的目标看板。若不手动调整，将默认固定到默认看板；固定后可在看板页继续查看、整理和追问。
        </Typography.Text>
        <Input.Search
          allowClear
          placeholder="搜索看板名称"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <div
          style={{
            border: '1px solid var(--nova-outline-soft)',
            borderRadius: 12,
            padding: 10,
            maxHeight: 320,
            overflow: 'auto',
            background: '#fafafe',
          }}
        >
          {dashboardsLoading ? (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <Spin />
            </div>
          ) : filteredDashboardOptions.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="没有匹配的看板"
            />
          ) : (
            <Radio.Group
              style={{ width: '100%' }}
              value={pinTargetDashboardId ?? defaultDashboardOption?.id}
              onChange={(event) => setPinTargetDashboardId(event.target.value)}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {filteredDashboardOptions.map((dashboard) => {
                  const selected =
                    (pinTargetDashboardId ?? defaultDashboardOption?.id) ===
                    dashboard.id;

                  return (
                    <label
                      key={dashboard.id}
                      style={{
                        display: 'block',
                        width: '100%',
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: selected
                            ? '1px solid rgba(141, 101, 225, 0.28)'
                            : '1px solid rgba(15, 23, 42, 0.08)',
                          background: selected
                            ? 'rgba(141, 101, 225, 0.08)'
                            : '#ffffff',
                        }}
                      >
                        <Radio value={dashboard.id} style={{ marginTop: 2 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Space size={8} wrap>
                            <Typography.Text strong>
                              {resolveDashboardDisplayName(dashboard.name)}
                            </Typography.Text>
                            {dashboard.isDefault ? (
                              <Tag color="purple">默认</Tag>
                            ) : null}
                            {dashboard.cacheEnabled ? (
                              <Tag color="blue">缓存开启</Tag>
                            ) : null}
                          </Space>
                          <div style={{ marginTop: 4 }}>
                            <Typography.Text type="secondary">
                              {dashboard.isDefault
                                ? '当前工作空间默认看板'
                                : '固定后可在该看板继续整理图表'}
                              {dashboard.scheduleFrequency
                                ? ` · ${dashboard.scheduleFrequency}`
                                : ''}
                            </Typography.Text>
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </Space>
            </Radio.Group>
          )}
        </div>
        <Divider style={{ margin: '4px 0' }} />
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Typography.Text type="secondary">
              没有合适的看板时，可直接新建一个并固定当前图表。
            </Typography.Text>
            <Button
              type="link"
              icon={<PlusOutlined />}
              disabled={pinSubmitting || createAndPinSubmitting}
              onClick={() => {
                if (createAndPinSubmitting) {
                  return;
                }

                setCreateFormOpen((previous) => {
                  const nextOpen = !previous;
                  if (!nextOpen) {
                    setCreateDashboardName('');
                  }
                  return nextOpen;
                });
              }}
            >
              {createFormOpen ? '收起' : '新建看板并固定'}
            </Button>
          </div>
          {createFormOpen ? (
            <Input.Group compact>
              <Input
                ref={createDashboardInputRef}
                style={{ width: 'calc(100% - 126px)' }}
                value={createDashboardName}
                disabled={pinSubmitting || createAndPinSubmitting}
                placeholder="输入新看板名称，例如：本周经营复盘"
                onChange={(event) => setCreateDashboardName(event.target.value)}
                onPressEnter={() => {
                  if (!canSubmitCreateAndPin) {
                    return;
                  }

                  void onCreateAndPin(createDashboardName);
                }}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                loading={createAndPinSubmitting}
                disabled={!canSubmitCreateAndPin}
                onClick={() => {
                  void onCreateAndPin(createDashboardName);
                }}
              >
                新建并固定
              </Button>
            </Input.Group>
          ) : null}
        </Space>
      </Space>
    </Modal>
  );
}
