import { Alert, Button, Tabs } from 'antd';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import WorkspacePrimaryPanel from '@/features/workspace/components/WorkspacePrimaryPanel';
import useWorkspacePageState from '@/features/workspace/useWorkspacePageState';
import { Path } from '@/utils/enum';

export default function ManageWorkspacePage() {
  const workspacePage = useWorkspacePageState();

  if (workspacePage.runtimeScopePage.guarding) {
    return (
      <ConsoleShellLayout
        navItems={buildNovaSettingsNavItems({
          activeKey: 'settingsWorkspace',
          onNavigate: workspacePage.runtimeScopeNavigation.pushWorkspace,
          showPlatformAdmin: workspacePage.isPlatformAdmin,
        })}
        title="工作空间"
        hideHeader
        contentBorderless
        hideHistorySection
        loading
        sidebarBackAction={{
          label: '返回主菜单',
          onClick: () =>
            workspacePage.runtimeScopeNavigation.pushWorkspace(Path.Home),
        }}
      />
    );
  }

  return (
    <ConsoleShellLayout
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsWorkspace',
        onNavigate: workspacePage.runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: workspacePage.isPlatformAdmin,
      })}
      title="工作空间"
      hideHeader
      contentBorderless
      hideHistorySection
      sidebarBackAction={{
        label: '返回主菜单',
        onClick: () =>
          workspacePage.runtimeScopeNavigation.pushWorkspace(Path.Home),
      }}
    >
      {workspacePage.error ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="加载工作区信息失败"
          description={workspacePage.error}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {workspacePage.samlCertificateAlertSummary ? (
        <Alert
          className="console-alert"
          type={workspacePage.samlCertificateAlertSummary.type}
          showIcon
          message={workspacePage.samlCertificateAlertSummary.message}
          description={workspacePage.samlCertificateAlertSummary.description}
          action={
            workspacePage.governanceCenterVisible ? (
              <Button
                onClick={() =>
                  workspacePage.runtimeScopeNavigation.pushWorkspace(
                    Path.SettingsIdentity,
                  )
                }
              >
                打开身份与目录
              </Button>
            ) : undefined
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Tabs
        activeKey={workspacePage.activeTab}
        onChange={(key) =>
          workspacePage.setActiveTab(key as typeof workspacePage.activeTab)
        }
        style={{ marginBottom: 16 }}
        items={[
          { key: 'mine', label: '工作空间列表' },
          { key: 'applications', label: '申请记录' },
        ]}
      />

      <WorkspacePrimaryPanel
        activeTab={workspacePage.activeTab}
        searchKeyword={workspacePage.searchKeyword}
        onSearchKeywordChange={workspacePage.setSearchKeyword}
        loading={workspacePage.loading}
        defaultWorkspaceId={workspacePage.defaultWorkspaceId}
        filteredWorkspaceCards={workspacePage.filteredWorkspaceCards}
        filteredDiscoverableWorkspaces={
          workspacePage.filteredDiscoverableWorkspaces
        }
        reviewQueue={workspacePage.reviewQueue}
        workspace={workspacePage.data?.workspace || null}
        canManageMembers={workspacePage.canManageMembers}
        workspaceAction={workspacePage.workspaceAction}
        reviewAction={workspacePage.reviewAction}
        onSetDefaultWorkspace={workspacePage.handleSetDefaultWorkspace}
        onWorkspaceAction={workspacePage.handleWorkspaceAction}
        onReviewAction={workspacePage.handleReviewAction}
      />
    </ConsoleShellLayout>
  );
}
