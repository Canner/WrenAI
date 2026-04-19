import { useState } from 'react';
import { Alert, message } from 'antd';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import useWorkspaceGovernanceOverview from '@/features/settings/useWorkspaceGovernanceOverview';
import UsersMembersSection from './UsersMembersSection';

export default function ManageUsersPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const { workspaceOverview, loading, refetchWorkspaceOverview } =
    useWorkspaceGovernanceOverview({
      enabled: runtimeScopePage.hasRuntimeScope && authSession.authenticated,
      errorMessage: '加载用户管理失败',
    });
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

  const permissionActions = workspaceOverview?.permissions?.actions || {};
  const canManageMembers = Boolean(
    permissionActions['workspace.member.invite'] ||
      permissionActions['workspace.member.status.update'],
  );

  const handleInviteMember = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      message.warning('请输入成员邮箱');
      return false;
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
      await refetchWorkspaceOverview();
      return true;
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(error, '邀请成员失败');
      if (errorMessage) {
        message.error(errorMessage);
      }
      return false;
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
      await refetchWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(error, '成员操作失败');
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setMemberAction(null);
    }
  };

  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsUsers',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });

  return (
    <ConsoleShellLayout
      title="用户管理"
      eyebrow="Users"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
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
        <UsersMembersSection
          loading={loading}
          memberCount={workspaceOverview?.stats?.memberCount || 0}
          reviewQueueCount={workspaceOverview?.stats?.reviewQueueCount || 0}
          canManageMembers={canManageMembers}
          inviteEmail={inviteEmail}
          inviteRole={inviteRole}
          inviteLoading={inviteLoading}
          members={workspaceOverview?.members || []}
          memberAction={memberAction}
          onInviteEmailChange={setInviteEmail}
          onInviteRoleChange={setInviteRole}
          onInviteMember={() => handleInviteMember()}
          onMemberAction={(memberId, action, extra) => {
            void handleMemberAction(memberId, action, extra);
          }}
        />
      )}
    </ConsoleShellLayout>
  );
}
