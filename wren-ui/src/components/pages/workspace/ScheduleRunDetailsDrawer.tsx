import {
  Alert,
  Descriptions,
  Divider,
  Drawer,
  Space,
  Tag,
  Typography,
} from 'antd';
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
  visible?: boolean;
  open?: boolean;
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
  const { visible, open, onClose, defaultValue } = props;
  const drawerOpen = open ?? visible ?? false;
  const runtimeIdentity = defaultValue?.detailJson?.runtimeIdentity || null;
  const overviewItems = defaultValue
    ? [
        {
          key: 'targetName',
          label: '任务名称',
          children: defaultValue.targetName,
        },
        {
          key: 'targetType',
          label: '任务类型',
          children: defaultValue.targetTypeLabel,
        },
        {
          key: 'status',
          label: '运行状态',
          children: (
            <Tag color={getStatusColor(defaultValue.status)}>
              {getStatusLabel(defaultValue.status)}
            </Tag>
          ),
        },
        {
          key: 'scheduleJobId',
          label: 'Schedule Job ID',
          children: renderCopyableValue(defaultValue.scheduleJobId),
        },
        {
          key: 'runId',
          label: '运行记录 ID',
          children: renderCopyableValue(defaultValue.id),
        },
        {
          key: 'traceId',
          label: 'Trace ID',
          children: renderCopyableValue(defaultValue.traceId),
        },
      ]
    : [];
  const executionTimeItems = defaultValue
    ? [
        {
          key: 'startedAt',
          label: '开始时间',
          children: renderValue(formatDateTime(defaultValue.startedAt)),
        },
        {
          key: 'finishedAt',
          label: '结束时间',
          children: renderValue(formatDateTime(defaultValue.finishedAt)),
        },
        {
          key: 'duration',
          label: '执行耗时',
          children: renderValue(
            formatDuration(defaultValue.startedAt, defaultValue.finishedAt),
          ),
        },
      ]
    : [];
  const runtimeIdentityItems = [
    {
      key: 'workspaceId',
      label: 'workspaceId',
      children: renderCopyableValue(runtimeIdentity?.workspaceId),
    },
    {
      key: 'knowledgeBaseId',
      label: 'knowledgeBaseId',
      children: renderCopyableValue(runtimeIdentity?.knowledgeBaseId),
    },
    {
      key: 'kbSnapshotId',
      label: 'kbSnapshotId',
      children: renderCopyableValue(runtimeIdentity?.kbSnapshotId),
    },
    {
      key: 'deployHash',
      label: 'deployHash',
      children: renderCopyableValue(runtimeIdentity?.deployHash),
    },
  ];

  return (
    <Drawer
      open={drawerOpen}
      title="运行详情"
      size={760}
      destroyOnHidden
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

          <Divider titlePlacement="start" plain>
            任务概览
          </Divider>
          <Descriptions
            bordered
            column={2}
            size="small"
            style={sectionStyle}
            items={overviewItems}
            styles={{
              label: { width: 116, color: 'var(--nova-text-secondary)' },
            }}
          />

          <Divider titlePlacement="start" plain>
            执行时间
          </Divider>
          <Descriptions
            bordered
            column={3}
            size="small"
            style={sectionStyle}
            items={executionTimeItems}
            styles={{ label: { color: 'var(--nova-text-secondary)' } }}
          />

          <Divider titlePlacement="start" plain>
            Runtime Identity
          </Divider>
          <Descriptions
            bordered
            column={2}
            size="small"
            style={sectionStyle}
            items={runtimeIdentityItems}
            styles={{
              label: { width: 132, color: 'var(--nova-text-secondary)' },
            }}
          />

          <Divider titlePlacement="start" plain>
            detailJson
          </Divider>
          <Space orientation="vertical" size={12} style={sectionStyle}>
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
          </Space>
        </>
      )}
    </Drawer>
  );
}
