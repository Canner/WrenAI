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
  getCertificateExpiryStatus,
  getIdentityProviderMetadataState,
  hasIdentityProviderScim,
} from '@/features/settings/identity/identityHealth';
import {
  IDENTITY_PROVIDER_OPTIONS,
  formatDateTime,
  metadataSourceColor,
  type WorkspaceGovernanceOverview,
} from '@/features/settings/workspaceGovernanceShared';

const { Paragraph, Text } = Typography;

type IdentityProviderRecord = NonNullable<
  WorkspaceGovernanceOverview['identityProviders']
>[number];

export default function IdentityProvidersSection({
  canManageIdentity,
  identityLoading,
  identityProviderConfig,
  identityProviderName,
  identityProviderType,
  identityProviders,
  loading,
  onCreate,
  onDelete,
  onToggle,
  scimEnabledProviderCount,
  setIdentityProviderConfig,
  setIdentityProviderName,
  setIdentityProviderType,
  samlCertificateAlertCount,
}: {
  canManageIdentity: boolean;
  identityLoading: boolean;
  identityProviderConfig: string;
  identityProviderName: string;
  identityProviderType: string;
  identityProviders: IdentityProviderRecord[];
  loading: boolean;
  onCreate: () => void;
  onDelete: (provider: IdentityProviderRecord) => void;
  onToggle: (provider: IdentityProviderRecord) => void;
  scimEnabledProviderCount: number;
  setIdentityProviderConfig: (value: string) => void;
  setIdentityProviderName: (value: string) => void;
  setIdentityProviderType: (value: string) => void;
  samlCertificateAlertCount: number;
}) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={15}>
        <Card title="身份源">
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            已启用{' '}
            {identityProviders.filter((provider) => provider.enabled).length} 个
            · SCIM {scimEnabledProviderCount} 个 · 告警{' '}
            {samlCertificateAlertCount} 个
          </Text>
          {!canManageIdentity ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="当前为只读视图"
              description="你可以查看身份源与目录组状态，但创建、编辑、删除仍需要具备 identity_provider.manage 或 group.manage 权限。"
            />
          ) : null}
          <Table
            rowKey="id"
            loading={loading || identityLoading}
            pagination={false}
            locale={{ emptyText: '当前没有企业身份源' }}
            dataSource={identityProviders}
            columns={[
              { title: '名称', dataIndex: 'name' },
              { title: '类型', dataIndex: 'providerType', width: 100 },
              {
                title: '健康',
                key: 'health',
                width: 140,
                render: (_value, record: IdentityProviderRecord) => {
                  if (record.providerType !== 'saml') {
                    return (
                      <Tag color={record.enabled ? 'green' : 'default'}>
                        {record.enabled ? '已启用' : '已停用'}
                      </Tag>
                    );
                  }
                  const health = getCertificateExpiryStatus(record.configJson);
                  return <Tag color={health.color}>{health.label}</Tag>;
                },
              },
              {
                title: 'Metadata',
                key: 'metadata',
                width: 220,
                render: (_value, record: IdentityProviderRecord) => {
                  const metadata = getIdentityProviderMetadataState(
                    record.configJson,
                  );
                  return (
                    <Space orientation="vertical" size={0}>
                      <Tag color={metadataSourceColor(metadata.source)}>
                        {metadata.label}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        最近刷新：{formatDateTime(metadata.fetchedAt)}
                      </Text>
                    </Space>
                  );
                },
              },
              {
                title: 'SCIM',
                key: 'scim',
                width: 100,
                render: (_value, record: IdentityProviderRecord) => (
                  <Tag
                    color={
                      hasIdentityProviderScim(record.configJson)
                        ? 'green'
                        : 'default'
                    }
                  >
                    {hasIdentityProviderScim(record.configJson)
                      ? '已配置'
                      : '未配置'}
                  </Tag>
                ),
              },
              {
                title: '状态',
                dataIndex: 'enabled',
                width: 100,
                render: (value: boolean) => (
                  <Tag color={value ? 'green' : 'default'}>
                    {value ? '启用' : '停用'}
                  </Tag>
                ),
              },
              ...(canManageIdentity
                ? [
                    {
                      title: '操作',
                      key: 'actions',
                      width: 180,
                      render: (
                        _value: unknown,
                        record: IdentityProviderRecord,
                      ) => (
                        <Space size={8}>
                          <Button onClick={() => onToggle(record)}>
                            {record.enabled ? '停用' : '启用'}
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
        <Card title="新建身份源">
          {canManageIdentity ? (
            <Form layout="vertical">
              <Row gutter={8}>
                <Col flex="120px">
                  <Form.Item label="类型">
                    <Select
                      value={identityProviderType}
                      onChange={setIdentityProviderType}
                      options={[...IDENTITY_PROVIDER_OPTIONS]}
                    />
                  </Form.Item>
                </Col>
                <Col flex="auto">
                  <Form.Item label="名称">
                    <Input
                      placeholder="新身份源名称"
                      value={identityProviderName}
                      onChange={(event) =>
                        setIdentityProviderName(event.target.value)
                      }
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="配置 JSON">
                <Input.TextArea
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  value={identityProviderConfig}
                  onChange={(event) =>
                    setIdentityProviderConfig(event.target.value)
                  }
                  placeholder='身份源配置 JSON，例如 {"issuer":"https://idp.example.com"}'
                />
              </Form.Item>
              <Button
                type="primary"
                loading={identityLoading}
                onClick={onCreate}
              >
                新建身份源
              </Button>
            </Form>
          ) : (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              当前账号暂无 identity_provider.manage / group.manage
              权限，本页维持只读。
            </Paragraph>
          )}
        </Card>
      </Col>
    </Row>
  );
}
