import { Fragment, useMemo, useState } from 'react';
import { Alert, Button, Input, Space, Tag, Typography, message } from 'antd';
import LockOutlined from '@ant-design/icons/LockOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import styled from 'styled-components';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { Path } from '@/utils/enum';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';

const { Text } = Typography;

const SectionStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const DetailGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(140px, 180px) minmax(0, 1fr);
  gap: 14px 20px;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
    gap: 8px;
  }
`;

const DetailLabel = styled.div`
  color: var(--nova-text-secondary);
  font-size: 13px;
`;

const DetailValue = styled.div`
  min-width: 0;
  color: var(--nova-text-primary);
  font-size: 14px;
`;

const PasswordStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 560px;
`;

const PasswordField = styled.label`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const InlineTagWrap = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

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

export default function SettingsPage() {
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
  const showPlatformManagement = Boolean(
    authActor?.platformRoleKeys?.includes('platform_admin') ||
      authActor?.isPlatformAdmin ||
      authSession.data?.isPlatformAdmin,
  );

  const workspaceRoleKeys =
    authActor?.workspaceRoleKeys?.length &&
    Array.isArray(authActor.workspaceRoleKeys)
      ? authActor.workspaceRoleKeys
      : [authSession.data?.membership?.roleKey || 'member'];
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

  const profileRows = useMemo(
    () => [
      {
        label: '姓名',
        value: authSession.data?.user?.displayName || '未设置',
      },
      {
        label: '登录账号',
        value: getLoginAccountLabel(authSession.data?.user?.email),
      },
      {
        label: '邮箱',
        value: authSession.data?.user?.email || '—',
      },
      {
        label: '默认工作空间',
        value: defaultWorkspaceName,
      },
      {
        label: '当前工作空间',
        value: currentWorkspaceName,
      },
      {
        label: '工作空间角色',
        value: (
          <InlineTagWrap>
            {workspaceRoleKeys.map((roleKey) => (
              <Tag key={roleKey} color="blue">
                {toDisplayRoleLabel(roleKey)}
              </Tag>
            ))}
          </InlineTagWrap>
        ),
      },
      {
        label: '平台角色',
        value:
          platformRoleKeys.length > 0 ? (
            <InlineTagWrap>
              {platformRoleKeys.map((roleKey) => (
                <Tag key={roleKey} color="purple">
                  {toDisplayRoleLabel(roleKey)}
                </Tag>
              ))}
            </InlineTagWrap>
          ) : (
            '普通账号'
          ),
      },
      {
        label: '会话状态',
        value: <Tag color="green">已登录</Tag>,
      },
    ],
    [
      authSession.data?.membership?.roleKey,
      authSession.data?.defaultWorkspaceId,
      authSession.data?.user?.displayName,
      authSession.data?.user?.email,
      authSession.data?.workspaces,
      authSession.data?.workspace?.name,
      currentWorkspaceName,
      defaultWorkspaceName,
      platformRoleKeys,
      workspaceRoleKeys,
    ],
  );

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
      message.error(error?.message || '停止代理登录失败');
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
      message.error(error?.message || '修改密码失败');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <ConsoleShellLayout
      title="个人资料"
      description="查看当前账号与修改密码。"
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
        <SectionStack>
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

          <section className="console-panel">
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">
                  <UserOutlined style={{ marginRight: 8 }} />
                  基本资料
                </div>
              </div>
            </div>
            <DetailGrid>
              {profileRows.map((row) => (
                <Fragment key={row.label}>
                  <DetailLabel>{row.label}</DetailLabel>
                  <DetailValue>{row.value}</DetailValue>
                </Fragment>
              ))}
            </DetailGrid>
          </section>

          <section className="console-panel">
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">
                  <LockOutlined style={{ marginRight: 8 }} />
                  修改密码
                </div>
                <div className="console-panel-subtitle">
                  仅本地登录账号支持直接修改密码。
                </div>
              </div>
            </div>
            <PasswordStack>
              <PasswordField>
                <Text>旧密码</Text>
                <Input.Password
                  size="large"
                  value={passwordForm.currentPassword}
                  onChange={(event) =>
                    updatePasswordField('currentPassword', event.target.value)
                  }
                  placeholder="输入当前密码"
                />
              </PasswordField>
              <PasswordField>
                <Text>新密码</Text>
                <Input.Password
                  size="large"
                  value={passwordForm.nextPassword}
                  onChange={(event) =>
                    updatePasswordField('nextPassword', event.target.value)
                  }
                  placeholder="至少 8 位"
                />
              </PasswordField>
              <PasswordField>
                <Text>确认新密码</Text>
                <Input.Password
                  size="large"
                  value={passwordForm.confirmPassword}
                  onChange={(event) =>
                    updatePasswordField('confirmPassword', event.target.value)
                  }
                  placeholder="再次输入新密码"
                  onPressEnter={() => void submitPasswordChange()}
                />
              </PasswordField>
              <Space size={10}>
                <Button
                  type="primary"
                  loading={savingPassword}
                  onClick={() => void submitPasswordChange()}
                >
                  保存密码
                </Button>
                <Button onClick={resetPasswordForm} disabled={savingPassword}>
                  重置
                </Button>
              </Space>
            </PasswordStack>
          </section>
        </SectionStack>
      )}
    </ConsoleShellLayout>
  );
}
