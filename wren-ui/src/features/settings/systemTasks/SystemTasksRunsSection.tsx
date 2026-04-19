import { Button, Card, Select, Space, Table, Tag, Typography } from 'antd';
import {
  formatDateTime,
  getStatusColor,
  getStatusLabel,
  type ScheduleRunView,
} from '@/features/settings/systemTasks/systemTasksPageUtils';

const { Text } = Typography;

export default function SystemTasksRunsSection({
  filteredRuns,
  loading,
  onChangeRunStatusFilter,
  onOpenRun,
  runStatusFilter,
  runStatusOptions,
}: {
  filteredRuns: ScheduleRunView[];
  loading: boolean;
  onChangeRunStatusFilter: (value: string) => void;
  onOpenRun: (run: ScheduleRunView) => void;
  runStatusFilter: string;
  runStatusOptions: Array<{ label: string; value: string }>;
}) {
  return (
    <Card
      title="最近运行记录"
      extra={
        <Space wrap>
          <Text type="secondary">运行状态</Text>
          <Select
            value={runStatusFilter}
            onChange={onChangeRunStatusFilter}
            options={runStatusOptions}
            style={{ minWidth: 180 }}
          />
        </Space>
      }
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        方便确认最近是否成功刷新、失败原因、trace 以及对应 runtime scope。
      </Text>
      <Table
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无运行记录' }}
        pagination={{ hideOnSinglePage: true, pageSize: 8 }}
        dataSource={filteredRuns}
        columns={[
          {
            title: '运行',
            key: 'run',
            render: (_value, record: ScheduleRunView) => (
              <Space direction="vertical" size={0}>
                <Text strong>{record.targetName}</Text>
                <Text type="secondary">{formatDateTime(record.startedAt)}</Text>
              </Space>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 110,
            render: (status: string) => (
              <Tag color={getStatusColor(status)}>{getStatusLabel(status)}</Tag>
            ),
          },
          {
            title: '详情',
            key: 'detail',
            render: (_value, record: ScheduleRunView) => (
              <Space direction="vertical" size={0}>
                {record.errorMessage ? (
                  <Text type="danger">{record.errorMessage}</Text>
                ) : (
                  <Text type="secondary">
                    {record.traceId ? `traceId: ${record.traceId}` : '执行完成'}
                  </Text>
                )}
                <Text type="secondary">
                  {record.detailJson?.runtimeIdentity?.deployHash
                    ? `deployHash: ${record.detailJson.runtimeIdentity.deployHash}`
                    : '沿用当前 runtime scope'}
                </Text>
              </Space>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 120,
            render: (_value, record: ScheduleRunView) => (
              <Button onClick={() => onOpenRun(record)}>查看详情</Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
