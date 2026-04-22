import { Button, Col, Row, Select, Space, Table, Tag, Typography } from 'antd';
import {
  formatDateTime,
  getStatusColor,
  getStatusLabel,
  type ScheduleJobView,
} from '@/features/settings/systemTasks/systemTasksPageUtils';

const { Text, Title } = Typography;

export default function SystemTasksJobsSection({
  canManageActions,
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
  canManageActions: boolean;
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
    <section>
      <Row
        align="middle"
        gutter={[12, 12]}
        justify="space-between"
        style={{ marginBottom: 12 }}
      >
        <Col flex="auto">
          <Title level={4} style={{ margin: 0 }}>
            任务列表
          </Title>
        </Col>
        <Col>
          <Space wrap>
            <Text type="secondary">任务状态</Text>
            <Select
              value={jobStatusFilter}
              onChange={onChangeJobStatusFilter}
              options={jobStatusOptions}
              style={{ minWidth: 180 }}
            />
          </Space>
        </Col>
      </Row>
      <Table
        className="console-table"
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无定时任务' }}
        pagination={{ hideOnSinglePage: true, pageSize: 6 }}
        tableLayout="fixed"
        dataSource={filteredJobs}
        columns={[
          {
            title: '任务',
            key: 'target',
            width: '18%',
            render: (_value, record: ScheduleJobView) => (
              <Space orientation="vertical" size={0} style={{ width: '100%' }}>
                <Text
                  strong
                  ellipsis={{ tooltip: record.targetName }}
                  style={{ maxWidth: '100%' }}
                >
                  {record.targetName}
                </Text>
                <Text
                  type="secondary"
                  ellipsis={{ tooltip: record.targetTypeLabel }}
                  style={{ maxWidth: '100%' }}
                >
                  {record.targetTypeLabel}
                </Text>
              </Space>
            ),
          },
          {
            title: '计划',
            key: 'cron',
            width: '14%',
            render: (_value, record: ScheduleJobView) => (
              <Space orientation="vertical" size={0} style={{ width: '100%' }}>
                <Text
                  ellipsis={{ tooltip: record.cronExpr }}
                  style={{ maxWidth: '100%' }}
                >
                  {record.cronExpr}
                </Text>
                <Text
                  type="secondary"
                  ellipsis={{ tooltip: record.timezone }}
                  style={{ maxWidth: '100%' }}
                >
                  {record.timezone}
                </Text>
              </Space>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 108,
            render: (status: string) => (
              <Tag color={getStatusColor(status)}>{getStatusLabel(status)}</Tag>
            ),
          },
          {
            title: '下次执行',
            dataIndex: 'nextRunAt',
            width: 148,
            render: (value: string | null) => formatDateTime(value),
          },
          {
            title: '最近执行',
            key: 'lastRun',
            width: '14%',
            render: (_value, record: ScheduleJobView) => (
              <Space orientation="vertical" size={0}>
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
            width: 360,
            render: (_value, record: ScheduleJobView) => {
              const isRunningAction =
                pendingAction?.jobId === record.id &&
                pendingAction.action === 'run';
              const isDisablingAction =
                pendingAction?.jobId === record.id &&
                pendingAction.action === 'disable';

              return (
                <Space size={8}>
                  {canManageActions ? (
                    <>
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
                    </>
                  ) : (
                    <Text type="secondary">只读</Text>
                  )}
                </Space>
              );
            },
          },
        ]}
      />
    </section>
  );
}
