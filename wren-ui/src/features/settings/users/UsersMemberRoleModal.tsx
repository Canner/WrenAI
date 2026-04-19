import { Alert, Form, Modal, Select, Typography } from 'antd';
import { ROLE_OPTIONS } from '@/features/settings/workspaceGovernanceShared';
import {
  getRoleAdjustmentDisabledReason,
  isRoleProtectedFromAdjustment,
} from './usersPageUtils';
import {
  type MemberAction,
  type WorkspaceMemberRecord,
} from './usersMembersSectionTypes';

const { Text } = Typography;

export default function UsersMemberRoleModal({
  canManageMembers,
  memberAction,
  nextRoleKey,
  onClose,
  onMemberAction,
  roleTargetMember,
  setNextRoleKey,
}: {
  canManageMembers: boolean;
  memberAction: { memberId: string; action: MemberAction } | null;
  nextRoleKey: string;
  onClose: () => void;
  onMemberAction: (
    memberId: string,
    action: MemberAction,
    extra?: Record<string, any>,
  ) => void;
  roleTargetMember: WorkspaceMemberRecord | null;
  setNextRoleKey: (value: string) => void;
}) {
  const roleChangeDisabledReason = roleTargetMember
    ? getRoleAdjustmentDisabledReason(roleTargetMember.roleKey)
    : null;

  return (
    <Modal
      title="调整角色"
      visible={Boolean(roleTargetMember)}
      destroyOnClose
      onCancel={onClose}
      onOk={() => {
        if (
          !roleTargetMember ||
          isRoleProtectedFromAdjustment(roleTargetMember.roleKey)
        ) {
          return;
        }
        onMemberAction(roleTargetMember.id, 'updateRole', {
          roleKey: nextRoleKey,
        });
        onClose();
      }}
      okText="保存角色"
      okButtonProps={{
        disabled:
          !roleTargetMember ||
          !canManageMembers ||
          Boolean(roleChangeDisabledReason) ||
          nextRoleKey === roleTargetMember?.roleKey,
        loading:
          memberAction?.memberId === roleTargetMember?.id &&
          memberAction?.action === 'updateRole',
      }}
    >
      {roleTargetMember ? (
        <Form layout="vertical">
          <Form.Item>
            <Text type="secondary">
              为{' '}
              {roleTargetMember.user?.displayName ||
                roleTargetMember.user?.email ||
                roleTargetMember.userId}
              调整工作空间角色。
            </Text>
          </Form.Item>
          {roleChangeDisabledReason ? (
            <Alert
              type="warning"
              showIcon
              message={roleChangeDisabledReason}
              style={{ marginBottom: 12 }}
            />
          ) : null}
          <Form.Item label="工作空间角色" style={{ marginBottom: 0 }}>
            <Select
              value={nextRoleKey}
              options={ROLE_OPTIONS}
              disabled={!canManageMembers || Boolean(roleChangeDisabledReason)}
              onChange={setNextRoleKey}
            />
          </Form.Item>
        </Form>
      ) : null}
    </Modal>
  );
}
