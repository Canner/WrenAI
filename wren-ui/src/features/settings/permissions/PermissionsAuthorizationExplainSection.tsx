import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Row,
  Col,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { WorkspaceAuthorizationExplainResponse } from '@/features/settings/workspaceGovernanceShared';
import { PERMISSION_PRINCIPAL_TYPE_OPTIONS } from './permissionsPageUtils';

const { Text } = Typography;

type PrincipalType = 'user' | 'group' | 'service_account';

export default function PermissionsAuthorizationExplainSection({
  canReadRoles,
  explainPrincipalType,
  explainPrincipalId,
  explainAction,
  explainResourceType,
  explainResourceId,
  explainResourceAttributes,
  explainLoading,
  explainResult,
  principalOptions,
  onExplainPrincipalTypeChange,
  onExplainPrincipalIdChange,
  onExplainActionChange,
  onExplainResourceTypeChange,
  onExplainResourceIdChange,
  onExplainResourceAttributesChange,
  onRunAuthorizationExplain,
}: {
  canReadRoles: boolean;
  explainPrincipalType: PrincipalType;
  explainPrincipalId: string | null;
  explainAction: string;
  explainResourceType: string;
  explainResourceId: string;
  explainResourceAttributes: string;
  explainLoading: boolean;
  explainResult: WorkspaceAuthorizationExplainResponse | null;
  principalOptions: Array<{ label: string; value: string }>;
  onExplainPrincipalTypeChange: (value: PrincipalType) => void;
  onExplainPrincipalIdChange: (value: string | null) => void;
  onExplainActionChange: (value: string) => void;
  onExplainResourceTypeChange: (value: string) => void;
  onExplainResourceIdChange: (value: string) => void;
  onExplainResourceAttributesChange: (value: string) => void;
  onRunAuthorizationExplain: () => void;
}) {
  return (
    <Card title="权限 Explain / Simulate">
      {!canReadRoles ? (
        <Alert
          type="info"
          showIcon
          message="当前为只读提示"
          description="你没有 role.read 权限，暂时无法执行权限解释。"
        />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Form layout="vertical">
            <Row gutter={[12, 0]}>
              <Col xs={24} md={8}>
                <Form.Item label="主体类型">
                  <Select
                    value={explainPrincipalType}
                    onChange={onExplainPrincipalTypeChange}
                    options={PERMISSION_PRINCIPAL_TYPE_OPTIONS}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="解释主体">
                  <Select
                    allowClear
                    showSearch
                    placeholder="选择主体"
                    optionFilterProp="label"
                    value={explainPrincipalId || undefined}
                    options={principalOptions}
                    onChange={(value) =>
                      onExplainPrincipalIdChange(value || null)
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="Action">
                  <Input
                    placeholder="可选，例如 connector.create"
                    value={explainAction}
                    onChange={(event) =>
                      onExplainActionChange(event.target.value)
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="resourceType">
                  <Input
                    placeholder="例如 workspace"
                    value={explainResourceType}
                    onChange={(event) =>
                      onExplainResourceTypeChange(event.target.value)
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="resourceId">
                  <Input
                    placeholder="可选，默认当前 workspace"
                    value={explainResourceId}
                    onChange={(event) =>
                      onExplainResourceIdChange(event.target.value)
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item label="resourceAttributes JSON">
                  <Input.TextArea
                    rows={3}
                    value={explainResourceAttributes}
                    onChange={(event) =>
                      onExplainResourceAttributesChange(event.target.value)
                    }
                    placeholder="可选"
                  />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Button
                  type="primary"
                  loading={explainLoading}
                  onClick={onRunAuthorizationExplain}
                >
                  执行 Explain
                </Button>
              </Col>
            </Row>
          </Form>

          {explainResult ? (
            <Alert
              type={explainResult.decision?.allowed ? 'success' : 'warning'}
              showIcon
              message={
                explainResult.decision
                  ? `决策：${explainResult.decision.allowed ? 'ALLOW' : 'DENY'}`
                  : '仅返回主体授权画像（未带 action）'
              }
              description={
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {explainResult.decision?.reason ? (
                    <Text type="secondary">
                      原因：{explainResult.decision.reason}
                    </Text>
                  ) : null}
                  <Descriptions column={1} colon={false}>
                    <Descriptions.Item label="Direct bindings">
                      {explainResult.directBindings.length}
                    </Descriptions.Item>
                    <Descriptions.Item label="Group bindings">
                      {explainResult.groupBindings.length}
                    </Descriptions.Item>
                    <Descriptions.Item label="Platform bindings">
                      {explainResult.platformBindings.length}
                    </Descriptions.Item>
                  </Descriptions>
                  <Space size={[8, 8]} wrap>
                    {explainResult.grantedActions.length > 0 ? (
                      explainResult.grantedActions.map((action) => (
                        <Tag key={action} color="blue">
                          {action}
                        </Tag>
                      ))
                    ) : (
                      <Text type="secondary">Granted actions：—</Text>
                    )}
                  </Space>
                </Space>
              }
            />
          ) : null}
        </Space>
      )}
    </Card>
  );
}
