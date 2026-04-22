import { useMemo } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
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

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  platform_admin: '平台管理员',
  platform_iam_admin: '平台权限管理员',
  platform_workspace_admin: '平台空间管理员',
  platform_auditor: '平台审计员',
  support_readonly: '支持只读',
  support_impersonator: '支持代理员',
};

function PlatformSummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Statistic
      title={<Text type="secondary">{label}</Text>}
      value={value}
      styles={{
        content: { fontSize: 28, fontWeight: 600, lineHeight: 1.2 },
      }}
    />
  );
}

export default function PlatformManagementPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;

  const authActor = authSession.data?.authorization?.actor;
  const displayedPlatformRoleKeys = useMemo(() => {
    const actorRoleKeys = (authActor?.platformRoleKeys || []).filter(Boolean);
    if (actorRoleKeys.length > 0) {
      return actorRoleKeys;
    }
    if (authActor?.isPlatformAdmin || authSession.data?.isPlatformAdmin) {
      return ['platform_admin'];
    }
    return [];
  }, [
    authActor?.isPlatformAdmin,
    authActor?.platformRoleKeys,
    authSession.data?.isPlatformAdmin,
  ]);
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
      description="平台治理角色视角的跨工作空间治理入口。"
      eyebrow="Platform Governance"
      {...shellProps}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          title="当前未登录"
          description="请先登录后再查看平台治理。"
        />
      ) : !showPlatformManagement ? (
        <Alert
          className="console-alert"
          type="error"
          showIcon
          title="当前账号没有平台治理权限"
          description="平台治理入口仅对具备平台治理角色的账号开放。"
        />
      ) : (
        <Card
          title="平台治理总览"
          extra={
            <Space wrap>
              <Button
                onClick={() =>
                  runtimeScopeNavigation.pushWorkspace(
                    Path.SettingsPlatformUsers,
                  )
                }
              >
                用户管理
              </Button>
              <Button
                onClick={() =>
                  runtimeScopeNavigation.pushWorkspace(
                    Path.SettingsPlatformPermissions,
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
                  runtimeScopeNavigation.pushWorkspace(
                    Path.SettingsPlatformWorkspaces,
                  )
                }
              >
                工作空间页
              </Button>
            </Space>
          }
        >
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Text type="secondary">
              当前工作空间 <b>{currentWorkspaceName}</b>
              ，可从这里快速进入用户、权限、审计与工作空间治理入口。
            </Text>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <PlatformSummaryMetric
                  label="平台角色数"
                  value={displayedPlatformRoleKeys.length}
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
              {displayedPlatformRoleKeys.map((roleKey) => (
                <Tag key={roleKey} color="purple">
                  {PLATFORM_ROLE_LABELS[roleKey] || roleKey}
                </Tag>
              ))}
              <Tag color="blue">当前工作空间 {currentWorkspaceName}</Tag>
              <Tag color="gold">高风险动作请前往权限管理 / 审计日志</Tag>
            </Space>
          </Space>
        </Card>
      )}
    </ConsoleShellLayout>
  );
}
