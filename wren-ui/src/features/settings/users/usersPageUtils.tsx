import { Tag } from 'antd';
import {
  formatRoleSourceLabel,
  type WorkspaceGovernanceSourceDetail,
} from '@/features/settings/workspaceGovernanceShared';
import { renderSourceDetails } from '@/features/settings/workspaceGovernanceSharedUi';

export const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
};

export const STATUS_LABELS: Record<string, string> = {
  active: '启用',
  invited: '待接受',
  pending: '待审批',
  rejected: '已拒绝',
  inactive: '停用',
};

export const applicationStatusColor = (status: string) => {
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

export const formatAccountLabel = (
  email?: string | null,
  fallback?: string,
) => {
  if (!email) {
    return fallback || '—';
  }

  const localPart = email.split('@')[0]?.trim();
  return localPart || email;
};

export const formatPhoneLabel = (
  phone?: string | null,
  mobile?: string | null,
  phoneNumber?: string | null,
) => phone || mobile || phoneNumber || '—';

export const isRoleProtectedFromAdjustment = (roleKey?: string | null) =>
  roleKey === 'owner' || roleKey === 'admin';

export const getRoleAdjustmentDisabledReason = (roleKey?: string | null) => {
  if (roleKey === 'owner') {
    return '工作空间所有者不支持在此调整角色';
  }
  if (roleKey === 'admin') {
    return '管理员账号不支持在此调整角色';
  }
  return null;
};

export const resolveRoleSourceSummary = ({
  workspaceActorSourceDetails,
  platformActorSourceDetails,
  workspaceRoleSource,
  platformRoleSource,
}: {
  workspaceActorSourceDetails?: WorkspaceGovernanceSourceDetail[];
  platformActorSourceDetails?: WorkspaceGovernanceSourceDetail[];
  workspaceRoleSource?: 'legacy' | 'role_binding' | null;
  platformRoleSource?: 'legacy' | 'role_binding' | null;
}) => ({
  workspace: workspaceActorSourceDetails?.length ? (
    renderSourceDetails(workspaceActorSourceDetails)
  ) : (
    <Tag color="blue">
      {formatRoleSourceLabel(workspaceRoleSource || undefined)}
    </Tag>
  ),
  platform: platformActorSourceDetails?.length ? (
    renderSourceDetails(platformActorSourceDetails)
  ) : (
    <Tag color="purple">
      {formatRoleSourceLabel(platformRoleSource || undefined)}
    </Tag>
  ),
});
