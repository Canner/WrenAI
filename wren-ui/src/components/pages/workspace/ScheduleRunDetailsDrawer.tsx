import { Alert, Drawer, Row, Col, Tag, Typography } from 'antd';
import JsonCodeBlock from '@/components/code/JsonCodeBlock';

const { Text } = Typography;

type RuntimeIdentity = {
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
};

export type ScheduleRunDetailView = {
  id: string;
  scheduleJobId: string;
  targetType: string;
  targetTypeLabel: string;
  targetName: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  traceId?: string | null;
  errorMessage?: string | null;
  detailJson?: {
    runtimeIdentity?: RuntimeIdentity | null;
    [key: string]: any;
  } | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  defaultValue?: ScheduleRunDetailView | null;
};

const sectionStyle = { marginBottom: 24 };

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDuration = (
  startedAt?: string | null,
  finishedAt?: string | null,
) => {
  if (!startedAt || !finishedAt) {
    return '—';
  }

  const started = new Date(startedAt).getTime();
  const finished = new Date(finishedAt).getTime();

  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return '—';
  }

  const durationMs = Math.max(0, finished - started);
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)} s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
};

const getStatusColor = (status?: string | null) => {
  switch (status) {
    case 'active':
    case 'succeeded':
      return 'green';
    case 'running':
      return 'blue';
    case 'failed':
      return 'red';
    case 'inactive':
      return 'default';
    default:
      return 'default';
  }
};

const getStatusLabel = (status?: string | null) => {
  switch (status) {
    case 'active':
      return '启用';
    case 'inactive':
      return '停用';
    case 'running':
      return '运行中';
    case 'succeeded':
      return '成功';
    case 'failed':
      return '失败';
    default:
      return status || '未知';
  }
};

const toPrettyJson = (value: Record<string, any>) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
};

const renderValue = (value?: string | null) => {
  if (!value) {
    return <Text type="secondary">—</Text>;
  }

  return <span>{value}</span>;
};

const renderCopyableValue = (value?: string | null) => {
  if (!value) {
    return <Text type="secondary">—</Text>;
  }

  return <Text copyable={{ text: value }}>{value}</Text>;
};

export default function ScheduleRunDetailsDrawer(props: Props) {
  const { visible, onClose, defaultValue } = props;
  const runtimeIdentity = defaultValue?.detailJson?.runtimeIdentity || null;

  return (
    <Drawer
      visible={visible}
      title="运行详情"
      width={760}
      destroyOnClose
      closable
      onClose={onClose}
      footer={null}
    >
      {!defaultValue ? (
        <Alert
          type="info"
          showIcon
          message="暂无运行详情"
          description="请选择一条运行记录查看执行上下文。"
        />
      ) : (
        <>
          {defaultValue.errorMessage ? (
            <Alert
              type="error"
              showIcon
              style={sectionStyle}
              message="最近一次执行失败"
              description={defaultValue.errorMessage}
            />
          ) : null}

          <div style={sectionStyle}>
            <Typography.Text className="d-block gray-7 mb-2">
              任务概览
            </Typography.Text>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  任务名称
                </Typography.Text>
                <div>{defaultValue.targetName}</div>
              </Col>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  任务类型
                </Typography.Text>
                <div>{defaultValue.targetTypeLabel}</div>
              </Col>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  运行状态
                </Typography.Text>
                <div>
                  <Tag color={getStatusColor(defaultValue.status)}>
                    {getStatusLabel(defaultValue.status)}
                  </Tag>
                </div>
              </Col>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  Schedule Job ID
                </Typography.Text>
                <div>{renderCopyableValue(defaultValue.scheduleJobId)}</div>
              </Col>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  运行记录 ID
                </Typography.Text>
                <div>{renderCopyableValue(defaultValue.id)}</div>
              </Col>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  Trace ID
                </Typography.Text>
                <div>{renderCopyableValue(defaultValue.traceId)}</div>
              </Col>
            </Row>
          </div>

          <div style={sectionStyle}>
            <Typography.Text className="d-block gray-7 mb-2">
              执行时间
            </Typography.Text>
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Typography.Text className="d-block gray-7 mb-2">
                  开始时间
                </Typography.Text>
                <div>{renderValue(formatDateTime(defaultValue.startedAt))}</div>
              </Col>
              <Col span={8}>
                <Typography.Text className="d-block gray-7 mb-2">
                  结束时间
                </Typography.Text>
                <div>
                  {renderValue(formatDateTime(defaultValue.finishedAt))}
                </div>
              </Col>
              <Col span={8}>
                <Typography.Text className="d-block gray-7 mb-2">
                  执行耗时
                </Typography.Text>
                <div>
                  {renderValue(
                    formatDuration(
                      defaultValue.startedAt,
                      defaultValue.finishedAt,
                    ),
                  )}
                </div>
              </Col>
            </Row>
          </div>

          <div style={sectionStyle}>
            <Typography.Text className="d-block gray-7 mb-2">
              Runtime Identity
            </Typography.Text>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  workspaceId
                </Typography.Text>
                <div>{renderCopyableValue(runtimeIdentity?.workspaceId)}</div>
              </Col>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  knowledgeBaseId
                </Typography.Text>
                <div>
                  {renderCopyableValue(runtimeIdentity?.knowledgeBaseId)}
                </div>
              </Col>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  kbSnapshotId
                </Typography.Text>
                <div>{renderCopyableValue(runtimeIdentity?.kbSnapshotId)}</div>
              </Col>
              <Col span={12}>
                <Typography.Text className="d-block gray-7 mb-2">
                  deployHash
                </Typography.Text>
                <div>{renderCopyableValue(runtimeIdentity?.deployHash)}</div>
              </Col>
            </Row>
          </div>

          <div style={sectionStyle}>
            <Typography.Text className="d-block gray-7 mb-2">
              detailJson
            </Typography.Text>
            {defaultValue.detailJson ? (
              <JsonCodeBlock
                code={toPrettyJson(defaultValue.detailJson)}
                backgroundColor="var(--gray-2)"
                maxHeight="420"
                copyable
              />
            ) : (
              <Text type="secondary">暂无结构化运行明细</Text>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}
