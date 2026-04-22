import { Alert } from 'antd';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import useWorkspaceGovernanceOverview from '@/features/settings/useWorkspaceGovernanceOverview';
import PermissionsRoleCatalogSection from './PermissionsRoleCatalogSection';
import usePermissionsRoleManagement from './usePermissionsRoleManagement';

export default function ManagePermissionsPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const workspaceOverviewRequestEnabled =
    runtimeScopePage.hasRuntimeScope && authSession.authenticated;
  const { workspaceOverview } = useWorkspaceGovernanceOverview({
    enabled: workspaceOverviewRequestEnabled,
    errorMessage: '加载权限管理失败',
  });
  const roleManagement = usePermissionsRoleManagement({
    enabled: workspaceOverviewRequestEnabled,
  });
  const permissionActions = workspaceOverview?.permissions?.actions || {};
  const canReadRoles = Boolean(permissionActions['role.read']);
  const canManageRoles = Boolean(permissionActions['role.manage']);
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsPermissions',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });

  return (
    <ConsoleShellLayout
      title="权限管理"
      eyebrow="Permissions"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          title="当前未登录"
          description="请先登录后再查看权限管理。"
        />
      ) : (
        <PermissionsRoleCatalogSection
          canReadRoles={canReadRoles}
          canManageRoles={canManageRoles}
          roleCatalog={roleManagement.roleCatalog}
          roleCatalogLoading={roleManagement.roleCatalogLoading}
          permissionCatalog={roleManagement.permissionCatalog}
          roleActionLoading={roleManagement.roleActionLoading}
          onCreateCustomRole={roleManagement.handleCreateCustomRole}
          onUpdateCustomRole={roleManagement.handleUpdateCustomRole}
          onDeleteCustomRole={roleManagement.handleDeleteCustomRole}
        />
      )}
    </ConsoleShellLayout>
  );
}
