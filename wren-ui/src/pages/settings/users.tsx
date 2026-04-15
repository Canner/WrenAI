import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import MailOutlined from '@ant-design/icons/MailOutlined';
import TeamOutlined from '@ant-design/icons/TeamOutlined';
import UserAddOutlined from '@ant-design/icons/UserAddOutlined';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import {
  ROLE_OPTIONS,
  WorkspaceGovernanceOverview,
  formatRoleSourceLabel,
  formatUserLabel,
  sourceDetailColor,
} from '@/components/pages/settings/workspaceGovernanceShared';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';

const { Text } = Typography;

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
};

const STATUS_LABELS: Record<string, string> = {
  active: '启用',
  invited: '待接受',
  pending: '待审批',
  rejected: '已拒绝',
  inactive: '停用',
};

const applicationStatusColor = (status: string) => {
  switch (status) {
    case 'active':
      return 'green';
    case 'pending':
      return 'gold';
    case 'invited':
      return 'blue';
    case 'rejected':
      return 'red';
    case 'inactive':
      return 'default';
    default:
      return 'default';
  }
};

const renderSourceDetails = (
  sourceDetails?: Array<{ kind?: string; label?: string }>,
  fallback?: string,
) => {
  if (!sourceDetails || sourceDetails.length === 0) {
    return <Text type="secondary">{fallback || '—'}</Text>;
  }

  return (
    <Space size={[4, 4]} wrap>
      {sourceDetails.map((detail, index) => (
        <Tag
          key={`${detail.kind || 'source'}-${index}`}
          color={sourceDetailColor(detail.kind)}
        >
          {detail.label || fallback || '—'}
        </Tag>
      ))}
    </Space>
  );
};

export default function SettingsUsersPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = Boolean(
    authSession.data?.authorization?.actor?.platformRoleKeys?.includes(
      'platform_admin',
    ) ||
      authSession.data?.authorization?.actor?.isPlatformAdmin ||
      authSession.data?.isPlatformAdmin,
  );

  const workspaceOverviewUrl = useMemo(
    () =>
      runtimeScopePage.hasRuntimeScope
        ? buildRuntimeScopeUrl('/api/v1/workspace/current')
        : null,
    [runtimeScopePage.hasRuntimeScope],
  );

  const [workspaceOverview, setWorkspaceOverview] =
    useState<WorkspaceGovernanceOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [memberAction, setMemberAction] = useState<{
    memberId: string;
    action:
      | 'approve'
      | 'reject'
      | 'updateRole'
      | 'deactivate'
      | 'reactivate'
      | 'remove';
  } | null>(null);

  const loadWorkspaceOverview = useCallback(async () => {
    if (!workspaceOverviewUrl || !authSession.authenticated) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(workspaceOverviewUrl, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '加载用户管理失败');
      }
      setWorkspaceOverview(payload as WorkspaceGovernanceOverview);
    } catch (error: any) {
      message.error(error?.message || '加载用户管理失败');
    } finally {
      setLoading(false);
    }
  }, [authSession.authenticated, workspaceOverviewUrl]);

  useEffect(() => {
    void loadWorkspaceOverview();
  }, [loadWorkspaceOverview]);

  const permissionActions = workspaceOverview?.permissions?.actions || {};
  const canManageMembers = Boolean(
    permissionActions['workspace.member.invite'] ||
      permissionActions['workspace.member.status.update'],
  );
  const authActor =
    workspaceOverview?.authorization?.actor ||
    authSession.data?.authorization?.actor;
  const workspaceActorSourceDetails =
    authActor && 'workspaceSourceDetails' in authActor
      ? ((authActor as any).workspaceSourceDetails as Array<{
          kind?: string;
          label?: string;
        }>)
      : undefined;
  const platformActorSourceDetails =
    authActor && 'platformSourceDetails' in authActor
      ? ((authActor as any).platformSourceDetails as Array<{
          kind?: string;
          label?: string;
        }>)
      : undefined;

  const handleInviteMember = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      message.warning('请输入成员邮箱');
      return;
    }

    try {
      setInviteLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/members'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, roleKey: inviteRole }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '邀请成员失败');
      }

      message.success('邀请已发送，成员会出现在待处理队列中');
      setInviteEmail('');
      setInviteRole('member');
      await loadWorkspaceOverview();
    } catch (error: any) {
      message.error(error?.message || '邀请成员失败');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleMemberAction = async (
    memberId: string,
    action:
      | 'approve'
      | 'reject'
      | 'updateRole'
      | 'deactivate'
      | 'reactivate'
      | 'remove',
    extra?: Record<string, any>,
  ) => {
    try {
      setMemberAction({ memberId, action });
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/workspace/members/${memberId}`),
        {
          method: action === 'remove' ? 'DELETE' : 'PATCH',
          headers:
            action === 'remove'
              ? undefined
              : { 'Content-Type': 'application/json' },
          credentials: 'include',
          body:
            action === 'remove'
              ? undefined
              : JSON.stringify({ action, ...(extra || {}) }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '成员操作失败');
      }

      message.success(
        action === 'approve'
          ? '已批准加入申请'
          : action === 'reject'
            ? '已拒绝加入申请'
            : action === 'updateRole'
              ? '成员角色已更新'
              : action === 'deactivate'
                ? '成员已停用'
                : action === 'reactivate'
                  ? '成员已重新启用'
                  : '成员已移除',
      );
      await loadWorkspaceOverview();
    } catch (error: any) {
      message.error(error?.message || '成员操作失败');
    } finally {
      setMemberAction(null);
    }
  };

  const members = workspaceOverview?.members || [];

  return (
    <ConsoleShellLayout
      title="用户管理"
      description="管理当前 Workspace 的成员邀请、审批、角色调整与状态变更。"
      eyebrow="Users"
      loading={runtimeScopePage.guarding || authSession.loading}
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsUsers',
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
          description="请先登录后再查看用户管理。"
        />
      ) : (
        <div className="console-grid">
          <section className="console-panel" style={{ gridColumn: 'span 12' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">
                  <TeamOutlined style={{ marginRight: 8 }} />
                  用户列表
                </div>
                <div className="console-panel-subtitle">
                  共 {workspaceOverview?.stats?.memberCount || 0} 名成员 ·
                  待处理 {workspaceOverview?.stats?.reviewQueueCount || 0} 条
                </div>
              </div>
            </div>
            <Space size={[8, 8]} wrap style={{ marginBottom: 12 }}>
              <Text type="secondary">Workspace 角色来源</Text>
              {workspaceActorSourceDetails?.length ? (
                renderSourceDetails(workspaceActorSourceDetails)
              ) : (
                <Tag color="blue">
                  {formatRoleSourceLabel(authActor?.workspaceRoleSource)}
                </Tag>
              )}
              <Text type="secondary">Platform 角色来源</Text>
              {platformActorSourceDetails?.length ? (
                renderSourceDetails(platformActorSourceDetails)
              ) : (
                <Tag color="purple">
                  {formatRoleSourceLabel(authActor?.platformRoleSource)}
                </Tag>
              )}
            </Space>
            {!canManageMembers ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="当前为只读视图"
                description="你可以查看成员、角色与审批状态，但邀请、审批、停用、移除等操作仍需要具备 workspace.member 管理权限。"
              />
            ) : null}
            {canManageMembers ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) 130px auto',
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                <Input
                  placeholder="输入成员邮箱，例如 analyst@example.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  prefix={<MailOutlined />}
                />
                <Select
                  value={inviteRole}
                  options={ROLE_OPTIONS}
                  onChange={setInviteRole}
                />
                <Button
                  type="primary"
                  icon={<UserAddOutlined />}
                  loading={inviteLoading}
                  onClick={() => void handleInviteMember()}
                >
                  邀请成员
                </Button>
              </div>
            ) : null}

            <Table
              className="console-table"
              rowKey="id"
              size="small"
              loading={loading}
              pagination={{
                pageSize: 10,
                hideOnSinglePage: true,
                size: 'small',
              }}
              locale={{ emptyText: '当前没有成员记录' }}
              dataSource={members}
              columns={[
                {
                  title: '成员',
                  key: 'user',
                  render: (_value, record: any) => (
                    <Space direction="vertical" size={0}>
                      <Text strong>
                        {formatUserLabel(
                          record.user?.displayName,
                          record.user?.email,
                          '未命名成员',
                        )}
                      </Text>
                      <Text type="secondary">
                        {record.user?.email || record.userId}
                      </Text>
                    </Space>
                  ),
                },
                {
                  title: '角色',
                  dataIndex: 'roleKey',
                  width: 150,
                  render: (roleKey: string, record: any) =>
                    roleKey === 'owner' || !canManageMembers ? (
                      <Tag color={roleKey === 'owner' ? 'purple' : 'blue'}>
                        {ROLE_LABELS[roleKey] || roleKey}
                      </Tag>
                    ) : (
                      <Select
                        size="small"
                        value={roleKey}
                        style={{ minWidth: 110 }}
                        options={ROLE_OPTIONS}
                        loading={
                          memberAction?.memberId === record.id &&
                          memberAction?.action === 'updateRole'
                        }
                        onChange={(value) =>
                          void handleMemberAction(record.id, 'updateRole', {
                            roleKey: value,
                          })
                        }
                      />
                    ),
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 120,
                  render: (value: string) => (
                    <Tag color={applicationStatusColor(value)}>
                      {STATUS_LABELS[value] || value}
                    </Tag>
                  ),
                },
                {
                  title: '来源',
                  key: 'source',
                  width: 180,
                  render: (_value, record: any) =>
                    renderSourceDetails(
                      record.sourceDetails,
                      record.status === 'pending'
                        ? '待审批'
                        : record.status === 'invited'
                          ? '邀请待接受'
                          : record.status === 'inactive'
                            ? '成员已停用'
                            : '成员状态变更',
                    ),
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 240,
                  render: (_value, record: any) => {
                    if (!canManageMembers || record.roleKey === 'owner') {
                      return <Text type="secondary">—</Text>;
                    }
                    const isBusy = memberAction?.memberId === record.id;
                    if (record.status === 'pending') {
                      return (
                        <Space wrap size={8}>
                          <Button
                            size="small"
                            type="primary"
                            loading={
                              isBusy && memberAction?.action === 'approve'
                            }
                            onClick={() =>
                              void handleMemberAction(record.id, 'approve')
                            }
                          >
                            批准
                          </Button>
                          <Button
                            size="small"
                            loading={
                              isBusy && memberAction?.action === 'reject'
                            }
                            onClick={() =>
                              void handleMemberAction(record.id, 'reject')
                            }
                          >
                            拒绝
                          </Button>
                        </Space>
                      );
                    }
                    return (
                      <Space wrap size={8}>
                        {record.status === 'active' ? (
                          <Button
                            size="small"
                            loading={
                              isBusy && memberAction?.action === 'deactivate'
                            }
                            onClick={() =>
                              void handleMemberAction(record.id, 'deactivate')
                            }
                          >
                            停用
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            type="primary"
                            loading={
                              isBusy && memberAction?.action === 'reactivate'
                            }
                            onClick={() =>
                              void handleMemberAction(record.id, 'reactivate')
                            }
                          >
                            启用
                          </Button>
                        )}
                        <Button
                          size="small"
                          danger
                          loading={isBusy && memberAction?.action === 'remove'}
                          onClick={() =>
                            void handleMemberAction(record.id, 'remove')
                          }
                        >
                          移除
                        </Button>
                      </Space>
                    );
                  },
                },
              ]}
            />
          </section>
        </div>
      )}
    </ConsoleShellLayout>
  );
}
