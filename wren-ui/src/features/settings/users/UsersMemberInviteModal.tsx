import { Form, Input, Modal, Select, Typography } from 'antd';
import { WORKSPACE_MEMBER_ROLE_OPTIONS } from '@/utils/workspaceGovernance';

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
      title="邀请成员"
      open={inviteModalOpen}
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
            当前版本通过成员邀请完成加入，成员接受邀请后会自动进入当前工作空间。
          </Text>
        </Form.Item>
        <Form.Item label="成员邮箱" style={{ marginBottom: 12 }}>
          <Input
            autoFocus
            value={inviteEmail}
            placeholder="输入用户邮箱，例如 analyst@example.com"
            onChange={(event) => onInviteEmailChange(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="工作空间权限" style={{ marginBottom: 0 }}>
          <Select
            value={inviteRole}
            options={[...WORKSPACE_MEMBER_ROLE_OPTIONS]}
            onChange={onInviteRoleChange}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
