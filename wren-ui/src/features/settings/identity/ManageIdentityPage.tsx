import { useMemo, useState } from 'react';
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
  message,
} from 'antd';
import LockOutlined from '@ant-design/icons/LockOutlined';
import ApartmentOutlined from '@ant-design/icons/ApartmentOutlined';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import {
  getCertificateExpiryStatus,
  getIdentityProviderMetadataState,
  hasIdentityProviderScim,
} from '@/features/settings/identity/identityHealth';
import {
  IDENTITY_PROVIDER_OPTIONS,
  ROLE_OPTIONS,
  formatDateTime,
  formatDirectoryGroupSource,
  formatUserLabel,
  metadataSourceColor,
  sourceDetailColor,
} from '@/features/settings/workspaceGovernanceShared';
import type { WorkspaceGovernanceOverview } from '@/features/settings/workspaceGovernanceShared';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import useWorkspaceGovernanceOverview from '@/features/settings/useWorkspaceGovernanceOverview';

const { Paragraph, Text } = Typography;

function IdentitySummaryMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: any;
}) {
  return (
    <Space direction="vertical" size={4}>
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

const renderSourceDetails = (
  sourceDetails?: Array<{ kind?: string; label?: string }>,
  fallbackLabel = '直接配置',
) => {
  if (!sourceDetails || sourceDetails.length === 0) {
    return <Tag color="blue">{fallbackLabel}</Tag>;
  }

  return (
    <Space size={[4, 4]} wrap>
      {sourceDetails.map((detail, index) => (
        <Tag
          key={`${detail.kind || 'detail'}-${index}`}
          color={sourceDetailColor(detail.kind)}
        >
          {detail.label || detail.kind || fallbackLabel}
        </Tag>
      ))}
    </Space>
  );
};

export default function SettingsIdentityPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const { workspaceOverview, loading, refetchWorkspaceOverview } =
    useWorkspaceGovernanceOverview({
      enabled: runtimeScopePage.hasRuntimeScope && authSession.authenticated,
      errorMessage: '加载身份与目录失败',
    });
  const [identityLoading, setIdentityLoading] = useState(false);
  const [groupLoading, setGroupLoading] = useState(false);
  const [identityProviderName, setIdentityProviderName] = useState('');
  const [identityProviderType, setIdentityProviderType] = useState('oidc');
  const [identityProviderConfig, setIdentityProviderConfig] = useState('{}');
  const [groupName, setGroupName] = useState('');
  const [groupRoleKey, setGroupRoleKey] = useState('member');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);

  const permissionActions = workspaceOverview?.permissions?.actions || {};
  const canManageIdentity = Boolean(
    permissionActions['identity_provider.manage'] ||
      permissionActions['group.manage'],
  );

  const memberOptions = useMemo(
    () =>
      (workspaceOverview?.members || []).map((member) => ({
        label: formatUserLabel(
          member.user?.displayName,
          member.user?.email,
          member.userId,
        ),
        value: member.userId,
      })),
    [workspaceOverview?.members],
  );

  const identityProviders = workspaceOverview?.identityProviders || [];
  const directoryGroups = workspaceOverview?.directoryGroups || [];

  const samlProviders = identityProviders.filter(
    (provider) => provider.providerType === 'saml' && provider.enabled,
  );
  const samlCertificateHealth = samlProviders.reduce(
    (acc, provider) => {
      const health = getCertificateExpiryStatus(provider.configJson);
      if (health.color === 'red') acc.expired += 1;
      else if (health.color === 'orange') acc.expiringSoon += 1;
      else acc.healthy += 1;
      return acc;
    },
    { expired: 0, expiringSoon: 0, healthy: 0 },
  );
  const scimEnabledProviderCount = identityProviders.filter((provider) =>
    hasIdentityProviderScim(provider.configJson),
  ).length;
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsIdentity',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });

  const parseIdentityProviderConfig = () => {
    const raw = identityProviderConfig.trim();
    if (!raw) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('身份源配置必须是 JSON 对象');
      }
      return parsed;
    } catch (error: any) {
      throw new Error(error?.message || '身份源配置 JSON 格式无效');
    }
  };

  const handleCreateIdentityProvider = async () => {
    if (!identityProviderName.trim()) {
      message.warning('请输入身份源名称');
      return;
    }

    try {
      setIdentityLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/identity-providers'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            providerType: identityProviderType,
            name: identityProviderName.trim(),
            enabled: false,
            configJson: parseIdentityProviderConfig(),
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建身份源失败');
      }

      message.success('身份源已创建');
      setIdentityProviderName('');
      setIdentityProviderType('oidc');
      setIdentityProviderConfig('{}');
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建身份源失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setIdentityLoading(false);
    }
  };

  const handleIdentityProviderAction = async (
    providerId: string,
    action: 'toggle' | 'delete',
    provider?: NonNullable<
      WorkspaceGovernanceOverview['identityProviders']
    >[number],
  ) => {
    try {
      setIdentityLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(
          `/api/v1/workspace/identity-providers/${providerId}`,
        ),
        {
          method: action === 'delete' ? 'DELETE' : 'PATCH',
          headers:
            action === 'toggle'
              ? { 'Content-Type': 'application/json' }
              : undefined,
          credentials: 'include',
          body:
            action === 'toggle'
              ? JSON.stringify({
                  enabled: !provider?.enabled,
                  name: provider?.name,
                  configJson: provider?.configJson || {},
                })
              : undefined,
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error ||
            (action === 'delete' ? '删除身份源失败' : '更新身份源状态失败'),
        );
      }

      message.success(
        action === 'delete' ? '身份源已删除' : '身份源状态已更新',
      );
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        action === 'delete' ? '删除身份源失败' : '更新身份源状态失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setIdentityLoading(false);
    }
  };

  const handleCreateDirectoryGroup = async () => {
    if (!groupName.trim()) {
      message.warning('请输入目录组名称');
      return;
    }

    try {
      setGroupLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/groups'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            displayName: groupName.trim(),
            roleKey: groupRoleKey,
            memberIds: groupMemberIds,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建目录组失败');
      }

      message.success('目录组已创建');
      setGroupName('');
      setGroupRoleKey('member');
      setGroupMemberIds([]);
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建目录组失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setGroupLoading(false);
    }
  };

  const handleDeleteDirectoryGroup = async (groupId: string) => {
    try {
      setGroupLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/workspace/groups/${groupId}`),
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '删除目录组失败');
      }

      message.success('目录组已删除');
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '删除目录组失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setGroupLoading(false);
    }
  };

  return (
    <ConsoleShellLayout
      title="身份与目录"
      description="管理企业 SSO、SCIM、证书健康与目录组映射。"
      eyebrow="Identity & Directory"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="当前未登录"
          description="请先登录后再查看身份与目录。"
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={6}>
                <IdentitySummaryMetric
                  label="启用身份源"
                  value={
                    identityProviders.filter((provider) => provider.enabled)
                      .length
                  }
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
                  value={
                    samlCertificateHealth.expired +
                    samlCertificateHealth.expiringSoon
                  }
                />
              </Col>
              <Col xs={24} md={6}>
                <IdentitySummaryMetric
                  label="目录组"
                  value={directoryGroups.length}
                  icon={<ApartmentOutlined />}
                />
              </Col>
            </Row>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={15}>
              <Card title="身份源">
                <Text
                  type="secondary"
                  style={{ display: 'block', marginBottom: 12 }}
                >
                  已启用{' '}
                  {
                    identityProviders.filter((provider) => provider.enabled)
                      .length
                  }{' '}
                  个 · SCIM {scimEnabledProviderCount} 个 · 告警{' '}
                  {samlCertificateHealth.expired +
                    samlCertificateHealth.expiringSoon}{' '}
                  个
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
                      render: (_value, record) => {
                        if (record.providerType !== 'saml') {
                          return (
                            <Tag color={record.enabled ? 'green' : 'default'}>
                              {record.enabled ? '已启用' : '已停用'}
                            </Tag>
                          );
                        }
                        const health = getCertificateExpiryStatus(
                          record.configJson,
                        );
                        return <Tag color={health.color}>{health.label}</Tag>;
                      },
                    },
                    {
                      title: 'Metadata',
                      key: 'metadata',
                      width: 220,
                      render: (_value, record) => {
                        const metadata = getIdentityProviderMetadataState(
                          record.configJson,
                        );
                        return (
                          <Space direction="vertical" size={0}>
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
                      render: (_value, record) => (
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
                              record: NonNullable<
                                WorkspaceGovernanceOverview['identityProviders']
                              >[number],
                            ) => (
                              <Space size={8}>
                                <Button
                                  onClick={() =>
                                    void handleIdentityProviderAction(
                                      record.id,
                                      'toggle',
                                      record,
                                    )
                                  }
                                >
                                  {record.enabled ? '停用' : '启用'}
                                </Button>
                                <Button
                                  danger
                                  onClick={() =>
                                    void handleIdentityProviderAction(
                                      record.id,
                                      'delete',
                                      record,
                                    )
                                  }
                                >
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
                      onClick={() => void handleCreateIdentityProvider()}
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

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={15}>
              <Card title="目录组">
                <Text
                  type="secondary"
                  style={{ display: 'block', marginBottom: 12 }}
                >
                  目录组 {directoryGroups.length} 个，可作为 SCIM
                  之外的最小治理补充。
                </Text>
                <Table
                  rowKey="id"
                  loading={loading || groupLoading}
                  pagination={false}
                  locale={{ emptyText: '当前没有目录组' }}
                  dataSource={directoryGroups}
                  columns={[
                    { title: '目录组', dataIndex: 'displayName' },
                    {
                      title: '角色',
                      dataIndex: 'roleKeys',
                      width: 120,
                      render: (value: string[] | undefined) =>
                        (value || []).join('、') || 'member',
                    },
                    {
                      title: '来源',
                      dataIndex: 'source',
                      width: 180,
                      render: (value: string | undefined, record) => (
                        <Space size={[4, 4]} wrap>
                          <Tag color={value === 'scim' ? 'purple' : 'blue'}>
                            {formatDirectoryGroupSource(value)}
                          </Tag>
                          {renderSourceDetails(record.sourceDetails)}
                        </Space>
                      ),
                    },
                    {
                      title: '成员数',
                      dataIndex: 'memberCount',
                      width: 100,
                      render: (value: number | undefined) => value || 0,
                    },
                    ...(canManageIdentity
                      ? [
                          {
                            title: '操作',
                            key: 'actions',
                            width: 120,
                            render: (
                              _value: unknown,
                              record: NonNullable<
                                WorkspaceGovernanceOverview['directoryGroups']
                              >[number],
                            ) => (
                              <Button
                                danger
                                onClick={() =>
                                  void handleDeleteDirectoryGroup(record.id)
                                }
                              >
                                删除
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
              <Card title="新建目录组">
                {canManageIdentity ? (
                  <Form layout="vertical">
                    <Form.Item label="目录组名称">
                      <Input
                        placeholder="新目录组名称"
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                      />
                    </Form.Item>
                    <Form.Item label="角色">
                      <Select
                        value={groupRoleKey}
                        onChange={setGroupRoleKey}
                        options={ROLE_OPTIONS}
                      />
                    </Form.Item>
                    <Form.Item label="成员">
                      <Select
                        mode="multiple"
                        allowClear
                        value={groupMemberIds}
                        options={memberOptions}
                        onChange={(values) => setGroupMemberIds(values)}
                        placeholder="可选：将当前成员加入目录组"
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                    <Button
                      loading={groupLoading}
                      onClick={() => void handleCreateDirectoryGroup()}
                    >
                      新建目录组
                    </Button>
                  </Form>
                ) : (
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    当前账号暂无 group.manage
                    权限，本页仅提供目录健康与绑定可见性。
                  </Paragraph>
                )}
              </Card>
            </Col>
          </Row>
        </Space>
      )}
    </ConsoleShellLayout>
  );
}
