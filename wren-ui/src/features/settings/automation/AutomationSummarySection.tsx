import ApiOutlined from '@ant-design/icons/ApiOutlined';
import RobotOutlined from '@ant-design/icons/RobotOutlined';
import { Alert, Card, Col, Row, Space, Statistic, Typography } from 'antd';

const { Text } = Typography;

function AutomationSummaryMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <Statistic
      title={<Text type="secondary">{label}</Text>}
      value={value}
      prefix={
        icon ? (
          <span style={{ display: 'inline-flex', fontSize: 20 }}>{icon}</span>
        ) : null
      }
      styles={{
        content: { fontSize: 28, fontWeight: 600, lineHeight: 1.2 },
      }}
    />
  );
}

export default function AutomationSummarySection({
  activeApiTokenCount,
  currentWorkspaceName,
  recentUsageCount,
  serviceAccountCount,
}: {
  activeApiTokenCount: number;
  currentWorkspaceName: string;
  recentUsageCount: number;
  serviceAccountCount: number;
}) {
  return (
    <Card>
      <Alert
        type="info"
        showIcon
        title="当前运行范围"
        description={
          <Space orientation="vertical" size={6}>
            <Text type="secondary">
              当前工作空间：<b>{currentWorkspaceName}</b>
            </Text>
            <Text type="secondary">
              Service Account、Token 生命周期与自动化入口统一在本页管理。
            </Text>
          </Space>
        }
      />
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <AutomationSummaryMetric
            label="服务账号"
            value={serviceAccountCount}
            icon={<RobotOutlined />}
          />
        </Col>
        <Col xs={24} md={8}>
          <AutomationSummaryMetric
            label="活跃 Token"
            value={activeApiTokenCount}
            icon={<ApiOutlined />}
          />
        </Col>
        <Col xs={24} md={8}>
          <AutomationSummaryMetric
            label="最近使用记录"
            value={recentUsageCount}
          />
        </Col>
      </Row>
    </Card>
  );
}
