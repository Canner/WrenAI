import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ROLE_OPTIONS,
  formatDateTime,
  type WorkspaceGovernanceOverview,
} from '@/features/settings/workspaceGovernanceShared';
import { renderSourceDetails } from '@/features/settings/workspaceGovernanceSharedUi';

const { Paragraph, Text } = Typography;

type ServiceAccountRecord = NonNullable<
  WorkspaceGovernanceOverview['serviceAccounts']
>[number];

export default function AutomationServiceAccountsSection({
  canManageMachineIdentity,
  loading,
  onCreate,
  onDelete,
  onSelectForToken,
  onToggle,
  selectedServiceAccountId,
  serviceAccountDescription,
  serviceAccountLoading,
  serviceAccountName,
  serviceAccounts,
  serviceAccountRoleKey,
  setServiceAccountDescription,
  setServiceAccountName,
  setServiceAccountRoleKey,
}: {
  canManageMachineIdentity: boolean;
  loading: boolean;
  onCreate: () => void;
  onDelete: (record: ServiceAccountRecord) => void;
  onSelectForToken: (serviceAccountId: string) => void;
  onToggle: (record: ServiceAccountRecord) => void;
  selectedServiceAccountId: string | null;
  serviceAccountDescription: string;
  serviceAccountLoading: boolean;
  serviceAccountName: string;
  serviceAccounts: ServiceAccountRecord[];
  serviceAccountRoleKey: string;
  setServiceAccountDescription: (value: string) => void;
  setServiceAccountName: (value: string) => void;
  setServiceAccountRoleKey: (value: string) => void;
}) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={15}>
        <Card title="服务账号">
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            最小权限、启停状态与最近使用记录。
          </Text>
          {!canManageMachineIdentity ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="当前为只读视图"
              description="你可以查看 service account 与 API Token 状态，但创建、轮换、吊销仍需要具备 service_account / api_token 管理权限。"
            />
          ) : null}
          <Table
            rowKey="id"
            loading={loading || serviceAccountLoading}
            pagination={false}
            locale={{ emptyText: '当前没有自动化身份' }}
            dataSource={serviceAccounts}
            columns={[
              { title: '服务账号', dataIndex: 'name' },
              { title: '角色', dataIndex: 'roleKey', width: 120 },
              {
                title: '来源',
                key: 'source',
                width: 160,
                render: (_value, record: ServiceAccountRecord) =>
                  renderSourceDetails(record.sourceDetails, '直接绑定'),
              },
              {
                title: '活跃 Token',
                dataIndex: 'activeTokenCount',
                width: 110,
                render: (value: number | null | undefined) => value || 0,
              },
              {
                title: '最近使用',
                dataIndex: 'lastUsedAt',
                width: 160,
                render: (value: string | null | undefined) =>
                  formatDateTime(value),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (value: string) => <Tag>{value}</Tag>,
              },
              ...(canManageMachineIdentity
                ? [
                    {
                      title: '操作',
                      key: 'actions',
                      width: 220,
                      render: (
                        _value: unknown,
                        record: ServiceAccountRecord,
                      ) => (
                        <Space size={8} wrap>
                          <Button
                            type={
                              selectedServiceAccountId === record.id
                                ? 'primary'
                                : 'default'
                            }
                            onClick={() => onSelectForToken(record.id)}
                          >
                            选中发 Token
                          </Button>
                          <Button onClick={() => onToggle(record)}>
                            {record.status === 'active' ? '停用' : '启用'}
                          </Button>
                          <Button danger onClick={() => onDelete(record)}>
                            删除
                          </Button>
                        </Space>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} xl={9}>
        <Card title="新建服务账号">
          {canManageMachineIdentity ? (
            <Form layout="vertical">
              <Form.Item label="服务账号名称">
                <Input
                  placeholder="服务账号名称"
                  value={serviceAccountName}
                  onChange={(event) =>
                    setServiceAccountName(event.target.value)
                  }
                />
              </Form.Item>
              <Form.Item label="描述">
                <Input
                  placeholder="描述（可选）"
                  value={serviceAccountDescription}
                  onChange={(event) =>
                    setServiceAccountDescription(event.target.value)
                  }
                />
              </Form.Item>
              <Form.Item label="角色">
                <Select
                  value={serviceAccountRoleKey}
                  onChange={setServiceAccountRoleKey}
                  options={ROLE_OPTIONS}
                />
              </Form.Item>
              <Button
                type="primary"
                loading={serviceAccountLoading}
                onClick={onCreate}
              >
                新建服务账号
              </Button>
            </Form>
          ) : (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              当前账号暂无自动化身份管理权限，本页仅提供运行状态与风险可见性。
            </Paragraph>
          )}
        </Card>
      </Col>
    </Row>
  );
}
