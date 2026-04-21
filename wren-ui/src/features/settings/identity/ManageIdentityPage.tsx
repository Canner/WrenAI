import { useMemo, useState } from 'react';
import { Alert, Space } from 'antd';
import { appMessage as message } from '@/utils/antdAppBridge';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import {
  getCertificateExpiryStatus,
  hasIdentityProviderScim,
} from '@/features/settings/identity/identityHealth';
import {
  formatUserLabel,
  type WorkspaceGovernanceOverview,
} from '@/features/settings/workspaceGovernanceShared';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import useWorkspaceGovernanceOverview from '@/features/settings/useWorkspaceGovernanceOverview';
import IdentitySummarySection from '@/features/settings/identity/IdentitySummarySection';
import IdentityProvidersSection from '@/features/settings/identity/IdentityProvidersSection';
import DirectoryGroupsSection from '@/features/settings/identity/DirectoryGroupsSection';

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
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsIdentity',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });

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
  const enabledProviderCount = identityProviders.filter(
    (provider) => provider.enabled,
  ).length;
  const samlCertificateHealth = identityProviders
    .filter((provider) => provider.providerType === 'saml' && provider.enabled)
    .reduce(
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
  const samlCertificateAlertCount =
    samlCertificateHealth.expired + samlCertificateHealth.expiringSoon;

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
    provider: NonNullable<
      WorkspaceGovernanceOverview['identityProviders']
    >[number],
    action: 'toggle' | 'delete',
  ) => {
    try {
      setIdentityLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(
          `/api/v1/workspace/identity-providers/${provider.id}`,
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
                  enabled: !provider.enabled,
                  name: provider.name,
                  configJson: provider.configJson || {},
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
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <IdentitySummarySection
            enabledProviderCount={enabledProviderCount}
            scimEnabledProviderCount={scimEnabledProviderCount}
            certificateAlertCount={samlCertificateAlertCount}
            directoryGroupCount={directoryGroups.length}
          />
          <IdentityProvidersSection
            canManageIdentity={canManageIdentity}
            identityLoading={identityLoading}
            identityProviderConfig={identityProviderConfig}
            identityProviderName={identityProviderName}
            identityProviderType={identityProviderType}
            identityProviders={identityProviders}
            loading={loading}
            onCreate={() => void handleCreateIdentityProvider()}
            onDelete={(provider) =>
              void handleIdentityProviderAction(provider, 'delete')
            }
            onToggle={(provider) =>
              void handleIdentityProviderAction(provider, 'toggle')
            }
            scimEnabledProviderCount={scimEnabledProviderCount}
            setIdentityProviderConfig={setIdentityProviderConfig}
            setIdentityProviderName={setIdentityProviderName}
            setIdentityProviderType={setIdentityProviderType}
            samlCertificateAlertCount={samlCertificateAlertCount}
          />
          <DirectoryGroupsSection
            canManageIdentity={canManageIdentity}
            directoryGroups={directoryGroups}
            groupLoading={groupLoading}
            groupMemberIds={groupMemberIds}
            groupName={groupName}
            groupRoleKey={groupRoleKey}
            loading={loading}
            memberOptions={memberOptions}
            onCreate={() => void handleCreateDirectoryGroup()}
            onDelete={(groupId) => void handleDeleteDirectoryGroup(groupId)}
            setGroupMemberIds={setGroupMemberIds}
            setGroupName={setGroupName}
            setGroupRoleKey={setGroupRoleKey}
          />
        </Space>
      )}
    </ConsoleShellLayout>
  );
}
