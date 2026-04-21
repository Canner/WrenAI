import { useState } from 'react';
import { Alert, Space } from 'antd';
import { appMessage as message } from '@/utils/antdAppBridge';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
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
import AutomationSummarySection from '@/features/settings/automation/AutomationSummarySection';
import AutomationServiceAccountsSection from '@/features/settings/automation/AutomationServiceAccountsSection';
import AutomationApiTokensSection from '@/features/settings/automation/AutomationApiTokensSection';

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
    serviceAccount: NonNullable<
      WorkspaceGovernanceOverview['serviceAccounts']
    >[number],
    action: 'toggle' | 'delete',
  ) => {
    try {
      setServiceAccountLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(
          `/api/v1/workspace/service-accounts/${serviceAccount.id}`,
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
                  status:
                    serviceAccount.status === 'active' ? 'inactive' : 'active',
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
      if (selectedServiceAccountId === serviceAccount.id) {
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
          body: JSON.stringify({ name: apiTokenName.trim() }),
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

  const handleRevokeApiToken = async (
    token: NonNullable<WorkspaceGovernanceOverview['apiTokens']>[number],
  ) => {
    try {
      setApiTokenLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/workspace/api-tokens/${token.id}`),
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
          title="当前未登录"
          description="请先登录后再查看自动化身份。"
        />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <AutomationSummarySection
            activeApiTokenCount={activeApiTokenCount}
            currentWorkspaceName={currentWorkspaceName}
            recentUsageCount={
              serviceAccounts.filter((account) => account.lastUsedAt).length
            }
            serviceAccountCount={serviceAccounts.length}
          />
          <AutomationServiceAccountsSection
            canManageMachineIdentity={canManageMachineIdentity}
            loading={loading}
            onCreate={() => void handleCreateServiceAccount()}
            onDelete={(record) =>
              void handleServiceAccountAction(record, 'delete')
            }
            onSelectForToken={(serviceAccountId) => {
              setSelectedServiceAccountId(serviceAccountId);
              setLatestPlainTextToken(null);
            }}
            onToggle={(record) =>
              void handleServiceAccountAction(record, 'toggle')
            }
            selectedServiceAccountId={selectedServiceAccountId}
            serviceAccountDescription={serviceAccountDescription}
            serviceAccountLoading={serviceAccountLoading}
            serviceAccountName={serviceAccountName}
            serviceAccounts={serviceAccounts}
            serviceAccountRoleKey={serviceAccountRoleKey}
            setServiceAccountDescription={setServiceAccountDescription}
            setServiceAccountName={setServiceAccountName}
            setServiceAccountRoleKey={setServiceAccountRoleKey}
          />
          <AutomationApiTokensSection
            apiTokenLoading={loading || apiTokenLoading}
            apiTokenName={apiTokenName}
            apiTokens={apiTokens}
            canManageMachineIdentity={canManageMachineIdentity}
            latestPlainTextToken={latestPlainTextToken}
            onCreate={() => void handleCreateApiToken()}
            onRevoke={(record) => void handleRevokeApiToken(record)}
            onSelectServiceAccount={(value) => {
              setSelectedServiceAccountId(value);
              setLatestPlainTextToken(null);
            }}
            selectedServiceAccountId={selectedServiceAccountId}
            serviceAccounts={serviceAccounts}
            setApiTokenName={setApiTokenName}
          />
        </Space>
      )}
    </ConsoleShellLayout>
  );
}
