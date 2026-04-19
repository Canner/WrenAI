import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  formatDateTime,
  type WorkspaceGovernanceOverview,
} from '@/features/settings/workspaceGovernanceShared';
import { renderSourceDetails } from '@/features/settings/workspaceGovernanceSharedUi';

const { Paragraph, Text } = Typography;

type ApiTokenRecord = NonNullable<
  WorkspaceGovernanceOverview['apiTokens']
>[number];
type ServiceAccountRecord = NonNullable<
  WorkspaceGovernanceOverview['serviceAccounts']
>[number];

export default function AutomationApiTokensSection({
  apiTokenLoading,
  apiTokenName,
  apiTokens,
  canManageMachineIdentity,
  latestPlainTextToken,
  onCreate,
  onRevoke,
  onSelectServiceAccount,
  selectedServiceAccountId,
  serviceAccounts,
  setApiTokenName,
}: {
  apiTokenLoading: boolean;
  apiTokenName: string;
  apiTokens: ApiTokenRecord[];
  canManageMachineIdentity: boolean;
  latestPlainTextToken: string | null;
  onCreate: () => void;
  onRevoke: (record: ApiTokenRecord) => void;
  onSelectServiceAccount: (value: string) => void;
  selectedServiceAccountId: string | null;
  serviceAccounts: ServiceAccountRecord[];
  setApiTokenName: (value: string) => void;
}) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={15}>
        <Card title="API Token">
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            到期、吊销与最近使用风险一并查看。
          </Text>
          <Table
            rowKey="id"
            loading={apiTokenLoading}
            pagination={false}
            locale={{ emptyText: '当前没有 API Token' }}
            dataSource={apiTokens}
            columns={[
              { title: 'Token', dataIndex: 'name' },
              {
                title: '归属账号',
                dataIndex: 'serviceAccountId',
                render: (value: string | null | undefined) =>
                  serviceAccounts.find((account) => account.id === value)
                    ?.name || '—',
              },
              {
                title: '来源',
                key: 'source',
                width: 150,
                render: (_value, record: ApiTokenRecord) =>
                  renderSourceDetails(record.sourceDetails, '服务账号 Token'),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 120,
                render: (value: string, record: ApiTokenRecord) => (
                  <Tag color={record.revokedAt ? 'red' : 'green'}>
                    {record.revokedAt ? '已吊销' : value}
                  </Tag>
                ),
              },
              {
                title: '到期',
                dataIndex: 'expiresAt',
                width: 150,
                render: (value: string | null | undefined) =>
                  formatDateTime(value),
              },
              {
                title: '最近使用',
                dataIndex: 'lastUsedAt',
                width: 150,
                render: (value: string | null | undefined) =>
                  formatDateTime(value),
              },
              ...(canManageMachineIdentity
                ? [
                    {
                      title: '操作',
                      key: 'actions',
                      width: 100,
                      render: (_value: unknown, record: ApiTokenRecord) =>
                        record.revokedAt ? null : (
                          <Button danger onClick={() => onRevoke(record)}>
                            吊销
                          </Button>
                        ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} xl={9}>
        <Card title="创建 Token">
          {canManageMachineIdentity ? (
            <Form layout="vertical">
              <Form.Item label="服务账号">
                <Select
                  placeholder="选择服务账号"
                  value={selectedServiceAccountId || undefined}
                  onChange={onSelectServiceAccount}
                  options={serviceAccounts.map((account) => ({
                    label: `${account.name} · ${account.roleKey}`,
                    value: account.id,
                  }))}
                />
              </Form.Item>
              <Form.Item label="Token 名称">
                <Input
                  placeholder="新 API Token 名称"
                  value={apiTokenName}
                  onChange={(event) => setApiTokenName(event.target.value)}
                />
              </Form.Item>
              <Button loading={apiTokenLoading} onClick={onCreate}>
                创建 Token
              </Button>
              {latestPlainTextToken ? (
                <Alert
                  style={{ marginTop: 16 }}
                  type="warning"
                  showIcon
                  message="请立即复制这个 Token"
                  description={<Text copyable>{latestPlainTextToken}</Text>}
                />
              ) : null}
            </Form>
          ) : (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              当前账号暂无 api_token.create 权限，本页仍可查看 Token
              风险状态与最近使用。
            </Paragraph>
          )}
        </Card>
      </Col>
    </Row>
  );
}
