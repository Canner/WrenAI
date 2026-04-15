import { Alert, Button, Space, Tag } from 'antd';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { Path } from '@/utils/enum';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';
export default function PlatformManagementPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;

  const authActor = authSession.data?.authorization?.actor;
  const showPlatformManagement = Boolean(
    authActor?.platformRoleKeys?.includes('platform_admin') ||
      authActor?.isPlatformAdmin ||
      authSession.data?.isPlatformAdmin,
  );

  const currentWorkspaceName =
    getReferenceDisplayWorkspaceName(
      runtimeSelectorState?.currentWorkspace?.name,
    ) || '当前工作空间';

  if (runtimeScopePage.guarding) {
    return (
      <ConsoleShellLayout
        title="平台治理"
        loading
        navItems={buildNovaSettingsNavItems({
          activeKey: 'settingsPlatform',
          onNavigate: runtimeScopeNavigation.pushWorkspace,
          showPlatformAdmin: true,
        })}
        hideHistorySection
        sidebarBackAction={{
          label: '返回主菜单',
          onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
        }}
      />
    );
  }

  return (
    <ConsoleShellLayout
      title="平台治理"
      description="平台管理员视角的跨工作空间治理入口。"
      eyebrow="Platform Governance"
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsPlatform',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: true,
      })}
      hideHistorySection
      hideHeader
      contentBorderless
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
          description="请先登录后再查看平台治理。"
        />
      ) : !showPlatformManagement ? (
        <Alert
          className="console-alert"
          type="error"
          showIcon
          message="当前账号没有平台治理权限"
          description="平台治理仅对 platform_admin 开放。"
        />
      ) : (
        <div className="console-grid">
          <section className="console-panel" style={{ gridColumn: 'span 12' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">平台治理</div>
                <div className="console-panel-subtitle">
                  平台角色{' '}
                  {(authActor?.platformRoleKeys || ['platform_admin']).length}{' '}
                  个 · 可见工作空间 {authSession.data?.workspaces?.length || 0}{' '}
                  个 · 当前工作空间 <b>{currentWorkspaceName}</b>
                </div>
              </div>
              <Space wrap>
                <Button
                  onClick={() =>
                    runtimeScopeNavigation.pushWorkspace(Path.SettingsUsers)
                  }
                >
                  用户管理
                </Button>
                <Button
                  onClick={() =>
                    runtimeScopeNavigation.pushWorkspace(
                      Path.SettingsPermissions,
                    )
                  }
                >
                  权限管理
                </Button>
                <Button
                  onClick={() =>
                    runtimeScopeNavigation.pushWorkspace(Path.SettingsAudit)
                  }
                >
                  审计日志
                </Button>
                <Button
                  onClick={() =>
                    runtimeScopeNavigation.pushWorkspace(Path.SettingsWorkspace)
                  }
                >
                  工作空间页
                </Button>
              </Space>
            </div>
            <Space wrap>
              {(authActor?.platformRoleKeys || ['platform_admin']).map(
                (roleKey) => (
                  <Tag key={roleKey} color="purple">
                    {roleKey === 'platform_admin' ? '平台管理员' : roleKey}
                  </Tag>
                ),
              )}
              <Tag color="blue">当前工作空间 {currentWorkspaceName}</Tag>
              <Tag color="gold">高风险动作请前往权限管理 / 审计日志</Tag>
            </Space>
          </section>
        </div>
      )}
    </ConsoleShellLayout>
  );
}
