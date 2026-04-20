import { Tag } from 'antd';
import {
  formatRoleSourceLabel,
  type WorkspaceGovernanceSourceDetail,
} from '@/features/settings/workspaceGovernanceShared';
import {
  getWorkspaceRoleLabel,
  normalizeWorkspaceRoleKeyForDisplay,
} from '@/utils/workspaceGovernance';
import { renderSourceDetails } from '@/features/settings/workspaceGovernanceSharedUi';
export { renderSourceDetails } from '@/features/settings/workspaceGovernanceSharedUi';

export type SourceDetail = WorkspaceGovernanceSourceDetail;

export const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  viewer: '查看者',
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

export const isRoleProtectedFromAdjustment = (_roleKey?: string | null) =>
  false;

export const getRoleAdjustmentDisabledReason = (_roleKey?: string | null) =>
  null;

export const resolveWorkspaceMemberRoleLabel = (roleKey?: string | null) =>
  ROLE_LABELS[normalizeWorkspaceRoleKeyForDisplay(roleKey) || ''] ||
  getWorkspaceRoleLabel(roleKey);

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
