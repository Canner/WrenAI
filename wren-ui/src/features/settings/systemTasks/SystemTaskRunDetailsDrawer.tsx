import {
  Alert,
  Descriptions,
  Divider,
  Drawer,
  Input,
  Tag,
  Typography,
} from 'antd';
import {
  formatDateTime,
  getStatusColor,
  getStatusLabel,
  type ScheduleRunView,
} from '@/features/settings/systemTasks/systemTasksPageUtils';

const { Paragraph, Text } = Typography;

type Props = {
  open: boolean;
  run: ScheduleRunView | null;
  onClose: () => void;
};

const sectionStyle = { marginBottom: 24 };

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

const renderValue = (value?: string | null) =>
  value ? <span>{value}</span> : <Text type="secondary">—</Text>;

const renderCopyableValue = (value?: string | null) =>
  value ? (
    <Paragraph copyable={{ text: value }} style={{ marginBottom: 0 }}>
      {value}
    </Paragraph>
  ) : (
    <Text type="secondary">—</Text>
  );

const toPrettyJson = (value: Record<string, any>) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
};

export default function SystemTaskRunDetailsDrawer({
  open,
  run,
  onClose,
}: Props) {
  const runtimeIdentity = run?.detailJson?.runtimeIdentity || null;

  const overviewItems = run
    ? [
        {
          key: 'targetName',
          label: '任务名称',
          children: run.targetName,
        },
        {
          key: 'targetType',
          label: '任务类型',
          children: run.targetTypeLabel,
        },
        {
          key: 'status',
          label: '运行状态',
          children: (
            <Tag color={getStatusColor(run.status)}>
              {getStatusLabel(run.status)}
            </Tag>
          ),
        },
        {
          key: 'scheduleJobId',
          label: '任务 ID',
          children: renderCopyableValue(run.scheduleJobId),
        },
        {
          key: 'runId',
          label: '运行记录 ID',
          children: renderCopyableValue(run.id),
        },
        {
          key: 'traceId',
          label: 'Trace ID',
          children: renderCopyableValue(run.traceId),
        },
      ]
    : [];

  const executionItems = run
    ? [
        {
          key: 'startedAt',
          label: '开始时间',
          children: renderValue(formatDateTime(run.startedAt)),
        },
        {
          key: 'finishedAt',
          label: '结束时间',
          children: renderValue(formatDateTime(run.finishedAt)),
        },
        {
          key: 'duration',
          label: '执行耗时',
          children: renderValue(formatDuration(run.startedAt, run.finishedAt)),
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
      open={open}
      title="运行详情"
      size="large"
      destroyOnHidden
      onClose={onClose}
      footer={null}
    >
      {!run ? (
        <Alert
          type="info"
          showIcon
          title="暂无运行详情"
          description="请选择一条运行记录查看执行上下文。"
        />
      ) : (
        <>
          {run.errorMessage ? (
            <Alert
              type="error"
              showIcon
              style={sectionStyle}
              title="最近一次执行失败"
              description={run.errorMessage}
            />
          ) : null}

          <Divider titlePlacement="start">任务概览</Divider>
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

          <Divider titlePlacement="start">执行时间</Divider>
          <Descriptions
            bordered
            column={3}
            size="small"
            style={sectionStyle}
            items={executionItems}
            styles={{ label: { color: 'var(--nova-text-secondary)' } }}
          />

          <Divider titlePlacement="start">Runtime Identity</Divider>
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

          <Divider titlePlacement="start">detailJson</Divider>
          {run.detailJson ? (
            <Input.TextArea
              readOnly
              value={toPrettyJson(run.detailJson)}
              autoSize={{ minRows: 12, maxRows: 20 }}
            />
          ) : (
            <Text type="secondary">暂无结构化运行明细</Text>
          )}
        </>
      )}
    </Drawer>
  );
}
