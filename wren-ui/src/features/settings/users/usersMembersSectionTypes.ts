import { ROLE_OPTIONS } from '@/features/settings/workspaceGovernanceShared';
import {
  ROLE_LABELS,
  STATUS_LABELS,
  type SourceDetail,
} from './usersPageUtils';

export type MemberAction =
  | 'approve'
  | 'reject'
  | 'updateRole'
  | 'deactivate'
  | 'reactivate'
  | 'remove';

export type MemberLifecycleActionConfig = {
  action: MemberAction;
  label: string;
  buttonType?: 'primary' | 'default';
  danger?: boolean;
};

export type WorkspaceMemberRecord = {
  id: string;
  userId?: string | null;
  roleKey: string;
  status: string;
  migrationSourceBindingId?: string | null;
  sourceDetails?: SourceDetail[];
  user?: {
    email?: string | null;
    displayName?: string | null;
    phone?: string | null;
    mobile?: string | null;
    phoneNumber?: string | null;
  } | null;
};

export const buildMemberLifecycleActions = (
  record: WorkspaceMemberRecord,
): MemberLifecycleActionConfig[] => {
  if (record.roleKey === 'owner') {
    return [];
  }

  switch (record.status) {
    case 'pending':
      return [
        { action: 'approve', label: '批准', buttonType: 'primary' },
        { action: 'reject', label: '拒绝', danger: true },
      ];
    case 'inactive':
      return [
        { action: 'reactivate', label: '重新启用', buttonType: 'primary' },
        { action: 'remove', label: '移除用户', danger: true },
      ];
    case 'invited':
    case 'rejected':
      return [{ action: 'remove', label: '移除用户', danger: true }];
    default:
      return [
        { action: 'deactivate', label: '停用账号' },
        { action: 'remove', label: '移除用户', danger: true },
      ];
  }
};

export const ROLE_FILTER_OPTIONS = [
  { label: '全部角色', value: 'all' },
  ...ROLE_OPTIONS,
].map((option) => ({ ...option, key: option.value }));

export const STATUS_FILTER_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: STATUS_LABELS.active, value: 'active' },
  { label: STATUS_LABELS.pending, value: 'pending' },
  { label: STATUS_LABELS.invited, value: 'invited' },
  { label: STATUS_LABELS.inactive, value: 'inactive' },
  { label: STATUS_LABELS.rejected, value: 'rejected' },
];

export const resolveMemberRoleLabel = (roleKey: string) =>
  ROLE_LABELS[roleKey] || roleKey;

export const resolveMemberSourceFallbackLabel = (status: string) => {
  if (status === 'pending') {
    return '待审批';
  }
  if (status === 'invited') {
    return '邀请待接受';
  }
  return '成员状态变更';
};
