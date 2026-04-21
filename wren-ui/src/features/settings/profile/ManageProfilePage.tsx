import { useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popover,
  Row,
  Col,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import KeyOutlined from '@ant-design/icons/KeyOutlined';
import LockOutlined from '@ant-design/icons/LockOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';

const { Text, Title } = Typography;

const SECURITY_TIPS = [
  {
    key: 'password',
    title: '设置独立密码',
    description: '密码建议包含大小写字母、数字与特殊字符，避免与其它系统重复。',
    Icon: KeyOutlined,
  },
  {
    key: 'sso',
    title: 'SSO 场景优先走统一身份系统',
    description:
      '如果当前账号通过企业 SSO 登录，请优先在统一身份系统内更新凭据。',
    Icon: SafetyCertificateOutlined,
  },
  {
    key: 'context',
    title: '修改后刷新敏感上下文',
    description:
      '完成修改后，如浏览器长期保持登录，建议重新打开敏感管理页以刷新安全上下文。',
    Icon: ReloadOutlined,
  },
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
    case 'platform_iam_admin':
      return '平台权限管理员';
    case 'platform_workspace_admin':
      return '平台空间管理员';
    case 'platform_auditor':
      return '平台审计员';
    case 'support_readonly':
      return '支持只读';
    case 'support_impersonator':
      return '支持代理员';
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

  const platformRoleKeys = authActor?.platformRoleKeys || [];
  const impersonation = authSession.data?.impersonation;
  const passwordRuleChecks = [
    {
      key: 'length',
      label: '至少 8 位',
      satisfied: passwordForm.nextPassword.length >= 8,
    },
    {
      key: 'composition',
      label: '包含字母、数字与特殊字符',
      satisfied:
        /[A-Za-z]/.test(passwordForm.nextPassword) &&
        /\d/.test(passwordForm.nextPassword) &&
        /[^A-Za-z0-9]/.test(passwordForm.nextPassword),
    },
    {
      key: 'distinct',
      label: '与当前密码保持不同',
      satisfied:
        Boolean(passwordForm.nextPassword) &&
        passwordForm.nextPassword !== passwordForm.currentPassword,
    },
  ];
  const satisfiedPasswordRuleCount = passwordRuleChecks.filter(
    (rule) => rule.satisfied,
  ).length;
  const remainingPasswordRuleCount =
    passwordRuleChecks.length - satisfiedPasswordRuleCount;
  const passwordStrengthMeta = !passwordForm.nextPassword
    ? {
        label: '未检查',
        color: 'var(--nova-text-secondary)',
      }
    : satisfiedPasswordRuleCount === passwordRuleChecks.length
      ? { label: '强', color: 'var(--ant-color-success)' }
      : satisfiedPasswordRuleCount >= 2
        ? { label: '中', color: 'var(--ant-color-warning)' }
        : { label: '弱', color: 'var(--ant-color-error)' };
  const passwordInputFeedback = !passwordForm.nextPassword
    ? null
    : remainingPasswordRuleCount === 0
      ? {
          Icon: CheckCircleFilled,
          label: `基础强度：${passwordStrengthMeta.label}，可以继续确认密码。`,
          color: 'var(--ant-color-success)',
        }
      : {
          Icon: InfoCircleOutlined,
          label: `基础强度：${passwordStrengthMeta.label}，还需满足 ${remainingPasswordRuleCount} 项规则。`,
          color: passwordStrengthMeta.color,
        };
  const confirmPasswordFeedback = !passwordForm.confirmPassword
    ? null
    : !passwordForm.nextPassword
      ? {
          Icon: InfoCircleOutlined,
          label: '请先输入新密码，再完成确认。',
          color: 'var(--nova-text-secondary)',
        }
      : passwordForm.confirmPassword !== passwordForm.nextPassword
        ? {
            Icon: InfoCircleOutlined,
            label: '与新密码不一致，请重新确认。',
            color: 'var(--ant-color-error)',
          }
        : {
            Icon: CheckCircleFilled,
            label: '两次输入一致，可直接保存。',
            color: 'var(--ant-color-success)',
          };
  const passwordRulesPopoverContent = (
    <Space orientation="vertical" size={8} style={{ maxWidth: 260 }}>
      <Text strong style={{ fontSize: 13 }}>
        密码规则
      </Text>
      <Space orientation="vertical" size={6} style={{ width: '100%' }}>
        {passwordRuleChecks.map((rule) => (
          <Space key={rule.key} size={6} align="start">
            {rule.satisfied ? (
              <CheckCircleFilled
                style={{
                  color: 'var(--ant-color-success)',
                  marginTop: 3,
                }}
              />
            ) : (
              <InfoCircleOutlined
                style={{
                  color: 'var(--nova-text-secondary)',
                  marginTop: 3,
                }}
              />
            )}
            <Text
              style={{
                fontSize: 12,
                color: rule.satisfied
                  ? 'var(--nova-text-primary)'
                  : 'var(--nova-text-secondary)',
              }}
            >
              {rule.label}
            </Text>
          </Space>
        ))}
      </Space>
    </Space>
  );
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
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsProfile',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: showPlatformManagement,
      })}
      hideHistorySection
      hideHeader
      contentBorderless
      hideSidebarBranding
      hideSidebarFooterPanel
      hideSidebarCollapseToggle
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
          description="请先登录后再查看个人设置。"
        />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          {impersonation?.active ? (
            <Alert
              className="console-alert"
              type="warning"
              showIcon
              message="当前处于代理登录（Impersonation）会话"
              description={
                <Space orientation="vertical" size={8}>
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

          <Card>
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
                    orientation="vertical"
                    size={12}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <Space orientation="vertical" size={4}>
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
                <Popover
                  trigger={['hover', 'click']}
                  placement="rightTop"
                  content={passwordRulesPopoverContent}
                >
                  <Button
                    aria-label="查看密码规则"
                    icon={<InfoCircleOutlined />}
                    size="small"
                    type="text"
                    style={{
                      width: 28,
                      height: 28,
                      padding: 0,
                      borderRadius: 999,
                      color: 'var(--nova-text-secondary)',
                      background: 'var(--ant-color-fill-quaternary)',
                      border: '1px solid var(--ant-color-border-secondary)',
                    }}
                  />
                </Popover>
              </Space>
            }
          >
            <Row gutter={[32, 24]} style={{ alignItems: 'stretch' }}>
              <Col xs={24} xl={15} style={{ display: 'flex' }}>
                <div style={{ maxWidth: 760, width: '100%' }}>
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
                    <Form.Item
                      label="新密码"
                      extra={
                        passwordInputFeedback ? (
                          <Space size={6} style={{ marginTop: 6 }}>
                            <passwordInputFeedback.Icon
                              style={{ color: passwordInputFeedback.color }}
                            />
                            <Text
                              style={{
                                fontSize: 12,
                                color: passwordInputFeedback.color,
                              }}
                            >
                              {passwordInputFeedback.label}
                            </Text>
                          </Space>
                        ) : null
                      }
                    >
                      <Input.Password
                        size="large"
                        value={passwordForm.nextPassword}
                        onChange={(event) =>
                          updatePasswordField(
                            'nextPassword',
                            event.target.value,
                          )
                        }
                        placeholder="至少 8 位"
                      />
                    </Form.Item>
                    <Form.Item label="确认新密码" style={{ marginBottom: 16 }}>
                      <Space
                        orientation="vertical"
                        size={8}
                        style={{ width: '100%' }}
                      >
                        <Input.Password
                          size="large"
                          status={
                            passwordForm.confirmPassword &&
                            passwordForm.nextPassword &&
                            passwordForm.confirmPassword !==
                              passwordForm.nextPassword
                              ? 'error'
                              : undefined
                          }
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
                        {confirmPasswordFeedback ? (
                          <Space size={6}>
                            <confirmPasswordFeedback.Icon
                              style={{ color: confirmPasswordFeedback.color }}
                            />
                            <Text
                              style={{
                                fontSize: 12,
                                color: confirmPasswordFeedback.color,
                              }}
                            >
                              {confirmPasswordFeedback.label}
                            </Text>
                          </Space>
                        ) : null}
                      </Space>
                    </Form.Item>
                    <Space size={12}>
                      <Button
                        type="primary"
                        size="large"
                        loading={savingPassword}
                        onClick={() => void submitPasswordChange()}
                        style={{ minWidth: 120 }}
                      >
                        保存密码
                      </Button>
                      <Button
                        size="large"
                        onClick={resetPasswordForm}
                        disabled={savingPassword}
                        style={{ minWidth: 88 }}
                      >
                        重置
                      </Button>
                    </Space>
                  </Form>
                </div>
              </Col>

              <Col xs={24} xl={9} style={{ display: 'flex' }}>
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    border: '1px solid var(--ant-color-border-secondary)',
                    borderRadius: 18,
                    padding: 18,
                    background:
                      'linear-gradient(180deg, rgba(117, 89, 255, 0.03), rgba(255, 255, 255, 0.98))',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <Space
                    orientation="vertical"
                    size={16}
                    style={{ width: '100%' }}
                  >
                    <Space align="start" size={10}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 12,
                          background: 'rgba(87, 97, 255, 0.10)',
                          color: '#5669FF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <SafetyCertificateOutlined style={{ fontSize: 18 }} />
                      </div>
                      <Space orientation="vertical" size={2}>
                        <Text strong style={{ fontSize: 18 }}>
                          安全建议
                        </Text>
                        <Text
                          type="secondary"
                          style={{ fontSize: 13, lineHeight: 1.6 }}
                        >
                          保持凭据唯一、可恢复且能快速审计，是 Nova
                          管理后台的默认安全基线。
                        </Text>
                      </Space>
                    </Space>

                    <div style={{ width: '100%' }}>
                      <div
                        style={{
                          borderTop:
                            '1px solid var(--ant-color-border-secondary)',
                        }}
                      />
                      {SECURITY_TIPS.map(
                        ({ key, title, description, Icon }, index) => (
                          <div
                            key={key}
                            style={{
                              display: 'flex',
                              gap: 10,
                              padding: '12px 0',
                              borderTop:
                                index > 0
                                  ? '1px solid var(--ant-color-border-secondary)'
                                  : undefined,
                            }}
                          >
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 8,
                                background: 'var(--ant-color-bg-container)',
                                border:
                                  '1px solid var(--ant-color-border-secondary)',
                                color: '#5669FF',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                marginTop: 2,
                              }}
                            >
                              <Icon style={{ fontSize: 14 }} />
                            </div>
                            <Space orientation="vertical" size={2}>
                              <Text strong style={{ fontSize: 13 }}>
                                {title}
                              </Text>
                              <Text
                                type="secondary"
                                style={{ fontSize: 12, lineHeight: 1.6 }}
                              >
                                {description}
                              </Text>
                            </Space>
                          </div>
                        ),
                      )}
                    </div>
                  </Space>
                </div>
              </Col>
            </Row>
          </Card>
        </Space>
      )}
    </ConsoleShellLayout>
  );
}
