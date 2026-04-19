import { Form, Input, Modal, Select, Typography } from 'antd';
import { ROLE_OPTIONS } from '@/features/settings/workspaceGovernanceShared';

const { Text } = Typography;

export default function UsersMemberInviteModal({
  canManageMembers,
  inviteEmail,
  inviteLoading,
  inviteModalOpen,
  inviteRole,
  onClose,
  onInviteEmailChange,
  onInviteRoleChange,
  onSubmit,
}: {
  canManageMembers: boolean;
  inviteEmail: string;
  inviteLoading: boolean;
  inviteModalOpen: boolean;
  inviteRole: string;
  onClose: () => void;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      title="新增用户"
      visible={inviteModalOpen}
      destroyOnClose
      onCancel={onClose}
      onOk={onSubmit}
      okText="发送邀请"
      confirmLoading={inviteLoading}
      okButtonProps={{ disabled: !canManageMembers }}
    >
      <Form layout="vertical">
        <Form.Item>
          <Text type="secondary">
            当前版本通过成员邀请完成新增，用户接受邀请后会自动进入当前工作空间。
          </Text>
        </Form.Item>
        <Form.Item label="用户邮箱" style={{ marginBottom: 12 }}>
          <Input
            autoFocus
            value={inviteEmail}
            placeholder="输入用户邮箱，例如 analyst@example.com"
            onChange={(event) => onInviteEmailChange(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="工作空间角色" style={{ marginBottom: 0 }}>
          <Select
            value={inviteRole}
            options={ROLE_OPTIONS}
            onChange={onInviteRoleChange}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
