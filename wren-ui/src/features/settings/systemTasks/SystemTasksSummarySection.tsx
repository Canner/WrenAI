import { Card, Col, Row, Space, Typography } from 'antd';
import {
  getStatusLabel,
  type ScheduleOverviewPayload,
} from '@/features/settings/systemTasks/systemTasksPageUtils';

const { Text } = Typography;

function SystemTaskSummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Space direction="vertical" size={4}>
      <Text type="secondary">{label}</Text>
      <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>
        {value}
      </div>
    </Space>
  );
}

export default function SystemTasksSummarySection({
  data,
}: {
  data: ScheduleOverviewPayload | null;
}) {
  return (
    <Card>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">
          当前工作空间 {data?.workspace?.name || '—'}
          {data?.currentKnowledgeBase?.name
            ? ` · 当前知识库 ${data.currentKnowledgeBase.name}`
            : ''}
        </Text>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={6}>
            <SystemTaskSummaryMetric
              label="任务总数"
              value={data?.stats.jobCount || 0}
            />
          </Col>
          <Col xs={24} md={6}>
            <SystemTaskSummaryMetric
              label="启用任务"
              value={data?.stats.activeJobCount || 0}
            />
          </Col>
          <Col xs={24} md={6}>
            <SystemTaskSummaryMetric
              label="最近运行数"
              value={data?.stats.runCount || 0}
            />
          </Col>
          <Col xs={24} md={6}>
            <SystemTaskSummaryMetric
              label="最新状态"
              value={getStatusLabel(data?.stats.latestRunStatus)}
            />
          </Col>
        </Row>
      </Space>
    </Card>
  );
}
