import { Button, Card, Select, Space, Table, Tag, Typography } from 'antd';
import {
  formatDateTime,
  getStatusColor,
  getStatusLabel,
  type ScheduleJobView,
} from '@/features/settings/systemTasks/systemTasksPageUtils';

const { Text } = Typography;

export default function SystemTasksJobsSection({
  filteredJobs,
  jobStatusFilter,
  jobStatusOptions,
  loading,
  onChangeJobStatusFilter,
  onDisable,
  onEdit,
  onRunNow,
  pendingAction,
}: {
  filteredJobs: ScheduleJobView[];
  jobStatusFilter: string;
  jobStatusOptions: Array<{ label: string; value: string }>;
  loading: boolean;
  onChangeJobStatusFilter: (value: string) => void;
  onDisable: (jobId: string) => void;
  onEdit: (job: ScheduleJobView) => void;
  onRunNow: (jobId: string) => void;
  pendingAction: { jobId: string; action: 'run' | 'disable' | 'update' } | null;
}) {
  return (
    <Card
      title="任务列表"
      extra={
        <Space wrap>
          <Text type="secondary">任务状态</Text>
          <Select
            value={jobStatusFilter}
            onChange={onChangeJobStatusFilter}
            options={jobStatusOptions}
            style={{ minWidth: 180 }}
          />
        </Space>
      }
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        当前支持对看板缓存刷新任务执行立即刷新、编辑计划与切换为仅手动刷新。
      </Text>
      <Table
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无定时任务' }}
        pagination={{ hideOnSinglePage: true, pageSize: 6 }}
        dataSource={filteredJobs}
        columns={[
          {
            title: '任务',
            key: 'target',
            render: (_value, record: ScheduleJobView) => (
              <Space direction="vertical" size={0}>
                <Text strong>{record.targetName}</Text>
                <Text type="secondary">{record.targetTypeLabel}</Text>
              </Space>
            ),
          },
          {
            title: '计划',
            key: 'cron',
            render: (_value, record: ScheduleJobView) => (
              <Space direction="vertical" size={0}>
                <Text>{record.cronExpr}</Text>
                <Text type="secondary">{record.timezone}</Text>
              </Space>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 120,
            render: (status: string) => (
              <Tag color={getStatusColor(status)}>{getStatusLabel(status)}</Tag>
            ),
          },
          {
            title: '下次执行',
            dataIndex: 'nextRunAt',
            width: 160,
            render: (value: string | null) => formatDateTime(value),
          },
          {
            title: '最近执行',
            key: 'lastRun',
            width: 200,
            render: (_value, record: ScheduleJobView) => (
              <Space direction="vertical" size={0}>
                <Text>{formatDateTime(record.lastRunAt)}</Text>
                {record.lastError ? (
                  <Text type="danger">{record.lastError}</Text>
                ) : (
                  <Text type="secondary">无错误</Text>
                )}
              </Space>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 240,
            render: (_value, record: ScheduleJobView) => {
              const isRunningAction =
                pendingAction?.jobId === record.id &&
                pendingAction.action === 'run';
              const isDisablingAction =
                pendingAction?.jobId === record.id &&
                pendingAction.action === 'disable';

              return (
                <Space size={8} wrap>
                  <Button
                    onClick={() => onRunNow(record.id)}
                    loading={isRunningAction}
                  >
                    立即刷新
                  </Button>
                  <Button
                    onClick={() => onEdit(record)}
                    loading={
                      pendingAction?.jobId === record.id &&
                      pendingAction.action === 'update'
                    }
                  >
                    编辑计划
                  </Button>
                  {record.status === 'active' ? (
                    <Button
                      onClick={() => onDisable(record.id)}
                      loading={isDisablingAction}
                    >
                      切为仅手动刷新
                    </Button>
                  ) : null}
                </Space>
              );
            },
          },
        ]}
      />
    </Card>
  );
}
