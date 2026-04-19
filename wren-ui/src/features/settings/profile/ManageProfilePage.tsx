import { useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  List,
  Row,
  Col,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import LockOutlined from '@ant-design/icons/LockOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';

const { Text, Title } = Typography;

const SECURITY_TIPS = [
  '密码建议包含大小写字母、数字与特殊字符，避免与其它系统重复。',
  '如果当前账号通过企业 SSO 登录，请优先在统一身份系统内更新凭据。',
  '完成修改后，如浏览器长期保持登录，建议重新打开敏感管理页以刷新安全上下文。',
];

const toDisplayRoleLabel = (roleKey: string) => {
  switch (roleKey) {
    case 'owner':
      return '工作空间所有者';
    case 'admin':
      return '工作空间管理员';
    case 'member':
    case 'viewer':
      return '工作空间成员';
    case 'platform_admin':
      return '平台管理员';
    default:
      return roleKey;
  }
};

const getLoginAccountLabel = (email?: string | null) => {
  if (!email) {
    return '—';
  }

  const localPart = email.split('@')[0]?.trim();
  return localPart || email;
};

const getIdentityInitial = (
  displayName?: string | null,
  email?: string | null,
) => {
  const source = (displayName || email || 'N').trim();
  return source.charAt(0).toUpperCase();
};

export default function ManageProfilePage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const [stoppingImpersonation, setStoppingImpersonation] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    nextPassword: '',
    confirmPassword: '',
  });

  const currentWorkspaceName =
    getReferenceDisplayWorkspaceName(
      runtimeSelectorState?.currentWorkspace?.name,
    ) || '当前工作空间';

  const authActor = authSession.data?.authorization?.actor;
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsProfile',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });

  const platformRoleKeys = authActor?.platformRoleKeys || [];
  const impersonation = authSession.data?.impersonation;
  const defaultWorkspaceName =
    getReferenceDisplayWorkspaceName(
      authSession.data?.workspaces?.find(
        (workspace) => workspace.id === authSession.data?.defaultWorkspaceId,
      )?.name ||
        authSession.data?.workspace?.name ||
        currentWorkspaceName,
    ) || '当前工作空间';

  const stopImpersonation = async () => {
    try {
      setStoppingImpersonation(true);
      const response = await fetch('/api/auth/impersonation/stop', {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '停止代理登录失败');
      }
      message.success('已退出代理登录，正在恢复原管理员会话');
      window.location.assign(
        buildRuntimeScopeUrl(Path.Home, {}, payload.runtimeSelector),
      );
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '停止代理登录失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setStoppingImpersonation(false);
    }
  };

  const updatePasswordField = (
    key: 'currentPassword' | 'nextPassword' | 'confirmPassword',
    value: string,
  ) => {
    setPasswordForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const resetPasswordForm = () => {
    setPasswordForm({
      currentPassword: '',
      nextPassword: '',
      confirmPassword: '',
    });
  };

  const submitPasswordChange = async () => {
    const currentPassword = passwordForm.currentPassword;
    const nextPassword = passwordForm.nextPassword;
    const confirmPassword = passwordForm.confirmPassword;

    if (!currentPassword || !nextPassword || !confirmPassword) {
      message.warning('请填写旧密码、新密码和确认密码');
      return;
    }

    if (nextPassword.length < 8) {
      message.warning('新密码至少需要 8 位');
      return;
    }

    if (nextPassword !== confirmPassword) {
      message.warning('两次输入的新密码不一致');
      return;
    }

    try {
      setSavingPassword(true);
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword,
          nextPassword,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '修改密码失败');
      }

      message.success('密码已更新');
      resetPasswordForm();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(error, '修改密码失败');
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <ConsoleShellLayout
      title="个人资料"
      description="查看当前账号、工作空间上下文与安全设置。"
      eyebrow="Account"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="当前未登录"
          description="请先登录后再查看个人设置。"
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {impersonation?.active ? (
            <Alert
              className="console-alert"
              type="warning"
              showIcon
              message="当前处于代理登录（Impersonation）会话"
              description={
                <Space direction="vertical" size={8}>
                  <Text type="secondary">
                    该会话正在代表其他成员执行操作，所有关键行为都会写入审计。
                  </Text>
                  {impersonation.reason ? (
                    <Text type="secondary">
                      代理原因：{impersonation.reason}
                    </Text>
                  ) : null}
                  {impersonation.canStop ? (
                    <Button
                      type="primary"
                      loading={stoppingImpersonation}
                      onClick={() => void stopImpersonation()}
                    >
                      退出代理登录
                    </Button>
                  ) : null}
                </Space>
              }
            />
          ) : null}

          <Card
            title={
              <Space size={8}>
                <UserOutlined />
                <span>基本资料</span>
              </Space>
            }
          >
            <Row gutter={[24, 24]} align="middle">
              <Col xs={24} xl={10}>
                <Space align="start" size={18} style={{ width: '100%' }}>
                  <Avatar
                    size={80}
                    style={{
                      background:
                        'linear-gradient(135deg, rgba(141, 101, 225, 0.92), rgba(84, 168, 255, 0.9))',
                      color: '#fff',
                      fontSize: 30,
                      fontWeight: 700,
                      flexShrink: 0,
                      boxShadow: '0 12px 28px rgba(84, 168, 255, 0.18)',
                    }}
                  >
                    {getIdentityInitial(
                      authSession.data?.user?.displayName,
                      authSession.data?.user?.email,
                    )}
                  </Avatar>

                  <Space
                    direction="vertical"
                    size={12}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <Space direction="vertical" size={4}>
                      <Title
                        level={2}
                        style={{
                          margin: 0,
                          fontSize: 30,
                          lineHeight: 1.1,
                        }}
                      >
                        {authSession.data?.user?.displayName || '未设置姓名'}
                      </Title>
                      <Text type="secondary">
                        {authSession.data?.user?.email || '未绑定邮箱'}
                      </Text>
                      <Text type="secondary">
                        登录账号 ·{' '}
                        {getLoginAccountLabel(authSession.data?.user?.email)}
                      </Text>
                    </Space>

                    <Space size={[8, 8]} wrap>
                      <Tag color={impersonation?.active ? 'gold' : 'default'}>
                        {impersonation?.active ? '代理登录中' : '标准会话'}
                      </Tag>
                      <Tag color="blue">当前空间 · {currentWorkspaceName}</Tag>
                    </Space>
                  </Space>
                </Space>
              </Col>

              <Col xs={24} xl={14}>
                <div
                  style={{
                    border: '1px solid var(--ant-color-border-secondary)',
                    borderRadius: 16,
                    padding: 20,
                    background: 'var(--ant-color-fill-quaternary)',
                  }}
                >
                  <Descriptions
                    column={2}
                    colon={false}
                    labelStyle={{ color: 'var(--nova-text-secondary)' }}
                    contentStyle={{ color: 'var(--nova-text-primary)' }}
                  >
                    <Descriptions.Item label="默认工作空间">
                      <Tag color="gold">{defaultWorkspaceName}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="平台角色">
                      <Space size={[8, 8]} wrap>
                        {platformRoleKeys.length > 0 ? (
                          platformRoleKeys.map((roleKey) => (
                            <Tag key={roleKey} color="purple">
                              {toDisplayRoleLabel(roleKey)}
                            </Tag>
                          ))
                        ) : (
                          <Tag color="default">普通账号</Tag>
                        )}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="当前工作空间">
                      {currentWorkspaceName}
                    </Descriptions.Item>
                    <Descriptions.Item label="会话类型">
                      <Tag color={impersonation?.active ? 'gold' : 'default'}>
                        {impersonation?.active ? '代理登录' : '标准会话'}
                      </Tag>
                    </Descriptions.Item>
                  </Descriptions>
                </div>
              </Col>
            </Row>
          </Card>

          <Card
            title={
              <Space size={8}>
                <LockOutlined />
                <span>修改密码</span>
              </Space>
            }
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={14}>
                <Form layout="vertical">
                  <Form.Item label="旧密码">
                    <Input.Password
                      size="large"
                      value={passwordForm.currentPassword}
                      onChange={(event) =>
                        updatePasswordField(
                          'currentPassword',
                          event.target.value,
                        )
                      }
                      placeholder="输入当前密码"
                    />
                  </Form.Item>
                  <Form.Item label="新密码">
                    <Input.Password
                      size="large"
                      value={passwordForm.nextPassword}
                      onChange={(event) =>
                        updatePasswordField('nextPassword', event.target.value)
                      }
                      placeholder="至少 8 位"
                    />
                  </Form.Item>
                  <Form.Item label="确认新密码" style={{ marginBottom: 16 }}>
                    <Input.Password
                      size="large"
                      value={passwordForm.confirmPassword}
                      onChange={(event) =>
                        updatePasswordField(
                          'confirmPassword',
                          event.target.value,
                        )
                      }
                      placeholder="再次输入新密码"
                      onPressEnter={() => void submitPasswordChange()}
                    />
                  </Form.Item>
                  <Space size={10}>
                    <Button
                      type="primary"
                      loading={savingPassword}
                      onClick={() => void submitPasswordChange()}
                    >
                      保存密码
                    </Button>
                    <Button
                      onClick={resetPasswordForm}
                      disabled={savingPassword}
                    >
                      重置
                    </Button>
                  </Space>
                </Form>
              </Col>

              <Col xs={24} lg={10}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Alert
                    type="info"
                    showIcon
                    message="安全建议"
                    description="保持凭据唯一、可恢复且能快速审计，是 Nova 管理后台的默认安全基线。"
                  />
                  <List
                    bordered
                    dataSource={SECURITY_TIPS}
                    renderItem={(item) => <List.Item>{item}</List.Item>}
                  />
                </Space>
              </Col>
            </Row>
          </Card>
        </Space>
      )}
    </ConsoleShellLayout>
  );
}
