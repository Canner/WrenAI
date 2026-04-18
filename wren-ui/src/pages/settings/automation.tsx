import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Input,
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
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import {
  ROLE_OPTIONS,
  WorkspaceGovernanceOverview,
  formatDateTime,
  sourceDetailColor,
} from '@/components/pages/settings/workspaceGovernanceShared';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';

const { Paragraph, Text } = Typography;

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
  const showPlatformManagement = Boolean(
    authSession.data?.authorization?.actor?.platformRoleKeys?.includes(
      'platform_admin',
    ) ||
      authSession.data?.authorization?.actor?.isPlatformAdmin ||
      authSession.data?.isPlatformAdmin,
  );

  const currentWorkspaceName =
    getReferenceDisplayWorkspaceName(
      runtimeSelectorState?.currentWorkspace?.name,
    ) || '当前工作空间';
  const workspaceOverviewUrl = useMemo(
    () =>
      runtimeScopePage.hasRuntimeScope
        ? buildRuntimeScopeUrl('/api/v1/workspace/current')
        : null,
    [runtimeScopePage.hasRuntimeScope],
  );

  const [workspaceOverview, setWorkspaceOverview] =
    useState<WorkspaceGovernanceOverview | null>(null);
  const [loading, setLoading] = useState(false);
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

  const loadWorkspaceOverview = useCallback(async () => {
    if (!workspaceOverviewUrl || !authSession.authenticated) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(workspaceOverviewUrl, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '加载自动化身份失败');
      }
      setWorkspaceOverview(payload as WorkspaceGovernanceOverview);
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载自动化身份失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [authSession.authenticated, workspaceOverviewUrl]);

  useEffect(() => {
    void loadWorkspaceOverview();
  }, [loadWorkspaceOverview]);

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
      await loadWorkspaceOverview();
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
      await loadWorkspaceOverview();
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
      await loadWorkspaceOverview();
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
      await loadWorkspaceOverview();
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
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsAutomation',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: showPlatformManagement,
      })}
      hideHistorySection
      sidebarBackAction={{
        label: '返回主菜单',
        onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
      }}
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
        <div className="console-grid">
          <section className="console-panel" style={{ gridColumn: 'span 12' }}>
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
          </section>

          <section className="console-panel" style={{ gridColumn: 'span 4' }}>
            <div className="console-panel-title">服务账号</div>
            <Text style={{ fontSize: 28, fontWeight: 600 }}>
              {serviceAccounts.length}
            </Text>
          </section>
          <section className="console-panel" style={{ gridColumn: 'span 4' }}>
            <div className="console-panel-title">活跃 Token</div>
            <Text style={{ fontSize: 28, fontWeight: 600 }}>
              {activeApiTokenCount}
            </Text>
          </section>
          <section className="console-panel" style={{ gridColumn: 'span 4' }}>
            <div className="console-panel-title">最近使用记录</div>
            <Text style={{ fontSize: 28, fontWeight: 600 }}>
              {serviceAccounts.filter((account) => account.lastUsedAt).length}
            </Text>
          </section>

          <section className="console-panel" style={{ gridColumn: 'span 7' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">
                  <RobotOutlined style={{ marginRight: 8 }} />
                  服务账号
                </div>
                <div className="console-panel-subtitle">
                  最小权限、启停状态与最近使用记录。
                </div>
              </div>
            </div>
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
              size="small"
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
                              size="small"
                              onClick={() => {
                                setSelectedServiceAccountId(record.id);
                                setLatestPlainTextToken(null);
                              }}
                            >
                              选中发 Token
                            </Button>
                            <Button
                              size="small"
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
                              size="small"
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
          </section>

          <section className="console-panel" style={{ gridColumn: 'span 5' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">新建服务账号</div>
                <div className="console-panel-subtitle">
                  机器主体默认应保持最小权限。
                </div>
              </div>
            </div>
            {canManageMachineIdentity ? (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Input
                  placeholder="服务账号名称"
                  value={serviceAccountName}
                  onChange={(event) =>
                    setServiceAccountName(event.target.value)
                  }
                />
                <Input
                  placeholder="描述（可选）"
                  value={serviceAccountDescription}
                  onChange={(event) =>
                    setServiceAccountDescription(event.target.value)
                  }
                />
                <Select
                  value={serviceAccountRoleKey}
                  onChange={setServiceAccountRoleKey}
                  options={ROLE_OPTIONS}
                />
                <Button
                  type="primary"
                  loading={serviceAccountLoading}
                  onClick={() => void handleCreateServiceAccount()}
                >
                  新建服务账号
                </Button>
              </Space>
            ) : (
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                当前账号暂无自动化身份管理权限，本页仅提供运行状态与风险可见性。
              </Paragraph>
            )}
          </section>

          <section className="console-panel" style={{ gridColumn: 'span 7' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">
                  <ApiOutlined style={{ marginRight: 8 }} />
                  API Token
                </div>
                <div className="console-panel-subtitle">
                  到期、吊销与最近使用风险一并查看。
                </div>
              </div>
            </div>
            <Table
              rowKey="id"
              size="small"
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
                    renderSourceDetails(record.sourceDetails, '服务账号 Token'),
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
                              size="small"
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
          </section>

          <section className="console-panel" style={{ gridColumn: 'span 5' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">创建 Token</div>
                <div className="console-panel-subtitle">
                  新建后只展示一次明文，请立即复制保存。
                </div>
              </div>
            </div>
            {canManageMachineIdentity ? (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
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
                <Input
                  placeholder="新 API Token 名称"
                  value={apiTokenName}
                  onChange={(event) => setApiTokenName(event.target.value)}
                />
                <Button
                  loading={apiTokenLoading}
                  onClick={() => void handleCreateApiToken()}
                >
                  创建 Token
                </Button>
                {latestPlainTextToken ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="请立即复制这个 Token"
                    description={<Text copyable>{latestPlainTextToken}</Text>}
                  />
                ) : null}
              </Space>
            ) : (
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                当前账号暂无 api_token.create 权限，本页仍可查看 Token
                风险状态与最近使用。
              </Paragraph>
            )}
          </section>
        </div>
      )}
    </ConsoleShellLayout>
  );
}
