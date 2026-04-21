import LockOutlined from '@ant-design/icons/LockOutlined';
import ApartmentOutlined from '@ant-design/icons/ApartmentOutlined';
import { Card, Col, Row, Space, Typography } from 'antd';

const { Text } = Typography;

function IdentitySummaryMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <Space orientation="vertical" size={4}>
      <Text type="secondary">{label}</Text>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 28,
          fontWeight: 600,
          lineHeight: 1.2,
        }}
      >
        {icon ? <span style={{ fontSize: 20 }}>{icon}</span> : null}
        <span>{value}</span>
      </div>
    </Space>
  );
}

export default function IdentitySummarySection({
  enabledProviderCount,
  scimEnabledProviderCount,
  certificateAlertCount,
  directoryGroupCount,
}: {
  enabledProviderCount: number;
  scimEnabledProviderCount: number;
  certificateAlertCount: number;
  directoryGroupCount: number;
}) {
  return (
    <Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}>
          <IdentitySummaryMetric
            label="启用身份源"
            value={enabledProviderCount}
            icon={<LockOutlined />}
          />
        </Col>
        <Col xs={24} md={6}>
          <IdentitySummaryMetric
            label="SCIM 已配置"
            value={scimEnabledProviderCount}
          />
        </Col>
        <Col xs={24} md={6}>
          <IdentitySummaryMetric
            label="证书告警"
            value={certificateAlertCount}
          />
        </Col>
        <Col xs={24} md={6}>
          <IdentitySummaryMetric
            label="目录组"
            value={directoryGroupCount}
            icon={<ApartmentOutlined />}
          />
        </Col>
      </Row>
    </Card>
  );
}
