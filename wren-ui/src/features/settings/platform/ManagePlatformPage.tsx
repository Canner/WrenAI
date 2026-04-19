import { Alert, Button, Card, Col, Row, Space, Tag, Typography } from 'antd';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';
import { Path } from '@/utils/enum';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';

const { Text } = Typography;

function PlatformSummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Space direction="vertical" size={4}>
      <Text type="secondary">{label}</Text>
      <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>
        {value}
      </div>
    </Space>
  );
}

export default function PlatformManagementPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;

  const authActor = authSession.data?.authorization?.actor;
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const guardShellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsPlatform',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: true,
    hideHeader: false,
    contentBorderless: false,
  });
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsPlatform',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: true,
  });

  const currentWorkspaceName =
    getReferenceDisplayWorkspaceName(
      runtimeSelectorState?.currentWorkspace?.name,
    ) || '当前工作空间';

  if (runtimeScopePage.guarding) {
    return <ConsoleShellLayout title="平台治理" loading {...guardShellProps} />;
  }

  return (
    <ConsoleShellLayout
      title="平台治理"
      description="平台管理员视角的跨工作空间治理入口。"
      eyebrow="Platform Governance"
      {...shellProps}
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
        <Card
          title="平台治理总览"
          extra={
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
                  runtimeScopeNavigation.pushWorkspace(Path.SettingsPermissions)
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
                  runtimeScopeNavigation.pushWorkspace(Path.Workspace)
                }
              >
                工作空间页
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Text type="secondary">
              当前工作空间 <b>{currentWorkspaceName}</b>
              ，可从这里快速进入用户、权限、审计与工作空间治理入口。
            </Text>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <PlatformSummaryMetric
                  label="平台角色数"
                  value={
                    (authActor?.platformRoleKeys || ['platform_admin']).length
                  }
                />
              </Col>
              <Col xs={24} md={8}>
                <PlatformSummaryMetric
                  label="可见工作空间"
                  value={authSession.data?.workspaces?.length || 0}
                />
              </Col>
              <Col xs={24} md={8}>
                <PlatformSummaryMetric
                  label="当前工作空间"
                  value={currentWorkspaceName}
                />
              </Col>
            </Row>
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
          </Space>
        </Card>
      )}
    </ConsoleShellLayout>
  );
}
