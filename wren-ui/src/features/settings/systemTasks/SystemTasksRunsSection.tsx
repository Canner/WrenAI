import { Button, Select, Space, Table, Tag, Typography } from 'antd';
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
    <section>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 18 }}>
          最近运行记录
        </Text>
        <Space wrap>
          <Text type="secondary">运行状态</Text>
          <Select
            value={runStatusFilter}
            onChange={onChangeRunStatusFilter}
            options={runStatusOptions}
            style={{ minWidth: 180 }}
          />
        </Space>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无运行记录（通常表示计划尚未到首次执行时间）' }}
        pagination={{ hideOnSinglePage: true, pageSize: 8 }}
        tableLayout="fixed"
        dataSource={filteredRuns}
        columns={[
          {
            title: '运行',
            key: 'run',
            width: '34%',
            render: (_value, record: ScheduleRunView) => (
              <Space orientation="vertical" size={0}>
                <Text strong>{record.targetName}</Text>
                <Text type="secondary">{formatDateTime(record.startedAt)}</Text>
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
            title: '详情',
            key: 'detail',
            width: '36%',
            render: (_value, record: ScheduleRunView) => (
              <Space orientation="vertical" size={0}>
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
            width: 128,
            render: (_value, record: ScheduleRunView) => (
              <Button onClick={() => onOpenRun(record)}>查看详情</Button>
            ),
          },
        ]}
      />
    </section>
  );
}
