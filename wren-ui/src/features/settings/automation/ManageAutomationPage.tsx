import { useState } from 'react';
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
import RobotOutlined from '@ant-design/icons/RobotOutlined';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import {
  ROLE_OPTIONS,
  formatDateTime,
  sourceDetailColor,
} from '@/features/settings/workspaceGovernanceShared';
import type { WorkspaceGovernanceOverview } from '@/features/settings/workspaceGovernanceShared';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import useWorkspaceGovernanceOverview from '@/features/settings/useWorkspaceGovernanceOverview';

const { Paragraph, Text } = Typography;

function AutomationSummaryMetric({
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
  fallbackLabel = '直接绑定',
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

export default function SettingsAutomationPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );

  const currentWorkspaceName =
    getReferenceDisplayWorkspaceName(
      runtimeSelectorState?.currentWorkspace?.name,
    ) || '当前工作空间';
  const { workspaceOverview, loading, refetchWorkspaceOverview } =
    useWorkspaceGovernanceOverview({
      enabled: runtimeScopePage.hasRuntimeScope && authSession.authenticated,
      errorMessage: '加载自动化身份失败',
    });
  const [serviceAccountLoading, setServiceAccountLoading] = useState(false);
  const [apiTokenLoading, setApiTokenLoading] = useState(false);
  const [serviceAccountName, setServiceAccountName] = useState('');
  const [serviceAccountDescription, setServiceAccountDescription] =
    useState('');
  const [serviceAccountRoleKey, setServiceAccountRoleKey] = useState('admin');
  const [selectedServiceAccountId, setSelectedServiceAccountId] = useState<
    string | null
  >(null);
  const [apiTokenName, setApiTokenName] = useState('');
  const [latestPlainTextToken, setLatestPlainTextToken] = useState<
    string | null
  >(null);

  const permissionActions = workspaceOverview?.permissions?.actions || {};
  const canManageMachineIdentity = Boolean(
    permissionActions['service_account.create'] ||
      permissionActions['api_token.create'],
  );

  const serviceAccounts = workspaceOverview?.serviceAccounts || [];
  const apiTokens = workspaceOverview?.apiTokens || [];
  const activeApiTokenCount = apiTokens.filter(
    (token) => !token.revokedAt,
  ).length;
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsAutomation',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
    hideHeader: false,
    contentBorderless: false,
  });

  const handleCreateServiceAccount = async () => {
    if (!serviceAccountName.trim()) {
      message.warning('请输入服务账号名称');
      return;
    }

    try {
      setServiceAccountLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/service-accounts'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: serviceAccountName.trim(),
            description: serviceAccountDescription.trim() || null,
            roleKey: serviceAccountRoleKey,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建服务账号失败');
      }

      message.success('服务账号已创建');
      setServiceAccountName('');
      setServiceAccountDescription('');
      setServiceAccountRoleKey('admin');
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建服务账号失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setServiceAccountLoading(false);
    }
  };

  const handleServiceAccountAction = async (
    serviceAccountId: string,
    action: 'toggle' | 'delete',
    status?: string,
  ) => {
    try {
      setServiceAccountLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(
          `/api/v1/workspace/service-accounts/${serviceAccountId}`,
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
                  status: status === 'active' ? 'inactive' : 'active',
                })
              : undefined,
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error ||
            (action === 'delete' ? '删除服务账号失败' : '更新服务账号失败'),
        );
      }

      message.success(
        action === 'delete' ? '服务账号已删除' : '服务账号状态已更新',
      );
      if (selectedServiceAccountId === serviceAccountId) {
        setSelectedServiceAccountId(null);
      }
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        action === 'delete' ? '删除服务账号失败' : '更新服务账号失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setServiceAccountLoading(false);
    }
  };

  const handleCreateApiToken = async () => {
    if (!selectedServiceAccountId) {
      message.warning('请选择服务账号');
      return;
    }
    if (!apiTokenName.trim()) {
      message.warning('请输入 Token 名称');
      return;
    }

    try {
      setApiTokenLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(
          `/api/v1/workspace/service-accounts/${selectedServiceAccountId}/tokens`,
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: apiTokenName.trim(),
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建 API Token 失败');
      }

      setLatestPlainTextToken(payload.plainTextToken || null);
      setApiTokenName('');
      message.success('API Token 已创建，请立即复制保存');
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建 API Token 失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setApiTokenLoading(false);
    }
  };

  const handleRevokeApiToken = async (tokenId: string) => {
    try {
      setApiTokenLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/workspace/api-tokens/${tokenId}`),
        {
          method: 'PATCH',
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '吊销 API Token 失败');
      }

      message.success('API Token 已吊销');
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '吊销 API Token 失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setApiTokenLoading(false);
    }
  };

  return (
    <ConsoleShellLayout
      title="自动化身份"
      description="管理 Service Account、API Token 与自动化任务身份。"
      eyebrow="Automation Identity"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="当前未登录"
          description="请先登录后再查看自动化身份。"
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card>
            <Alert
              type="info"
              showIcon
              message="当前运行范围"
              description={
                <Space direction="vertical" size={6}>
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
                  value={serviceAccounts.length}
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
                  value={
                    serviceAccounts.filter((account) => account.lastUsedAt)
                      .length
                  }
                />
              </Col>
            </Row>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={15}>
              <Card title="服务账号">
                <Text
                  type="secondary"
                  style={{ display: 'block', marginBottom: 12 }}
                >
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
                      render: (_value, record) =>
                        renderSourceDetails(record.sourceDetails),
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
                              record: NonNullable<
                                WorkspaceGovernanceOverview['serviceAccounts']
                              >[number],
                            ) => (
                              <Space size={8} wrap>
                                <Button
                                  onClick={() => {
                                    setSelectedServiceAccountId(record.id);
                                    setLatestPlainTextToken(null);
                                  }}
                                >
                                  选中发 Token
                                </Button>
                                <Button
                                  onClick={() =>
                                    void handleServiceAccountAction(
                                      record.id,
                                      'toggle',
                                      record.status,
                                    )
                                  }
                                >
                                  {record.status === 'active' ? '停用' : '启用'}
                                </Button>
                                <Button
                                  danger
                                  onClick={() =>
                                    void handleServiceAccountAction(
                                      record.id,
                                      'delete',
                                      record.status,
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
                      onClick={() => void handleCreateServiceAccount()}
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

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={15}>
              <Card title="API Token">
                <Text
                  type="secondary"
                  style={{ display: 'block', marginBottom: 12 }}
                >
                  到期、吊销与最近使用风险一并查看。
                </Text>
                <Table
                  rowKey="id"
                  loading={loading || apiTokenLoading}
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
                      render: (_value, record) =>
                        renderSourceDetails(
                          record.sourceDetails,
                          '服务账号 Token',
                        ),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 120,
                      render: (value: string, record) => (
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
                            render: (
                              _value: unknown,
                              record: NonNullable<
                                WorkspaceGovernanceOverview['apiTokens']
                              >[number],
                            ) =>
                              record.revokedAt ? null : (
                                <Button
                                  danger
                                  onClick={() =>
                                    void handleRevokeApiToken(record.id)
                                  }
                                >
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
                        onChange={(value) => {
                          setSelectedServiceAccountId(value);
                          setLatestPlainTextToken(null);
                        }}
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
                        onChange={(event) =>
                          setApiTokenName(event.target.value)
                        }
                      />
                    </Form.Item>
                    <Button
                      loading={apiTokenLoading}
                      onClick={() => void handleCreateApiToken()}
                    >
                      创建 Token
                    </Button>
                    {latestPlainTextToken ? (
                      <Alert
                        style={{ marginTop: 16 }}
                        type="warning"
                        showIcon
                        message="请立即复制这个 Token"
                        description={
                          <Text copyable>{latestPlainTextToken}</Text>
                        }
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
        </Space>
      )}
    </ConsoleShellLayout>
  );
}
