import {
  Alert,
  Button,
  Descriptions,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  STATUS_LABELS,
  applicationStatusColor,
  formatAccountLabel,
  formatPhoneLabel,
  renderSourceDetails,
  resolveWorkspaceMemberRoleLabel,
} from './usersPageUtils';
import {
  buildMemberLifecycleActions,
  resolveMemberSourceFallbackLabel,
  type MemberAction,
  type WorkspaceMemberRecord,
} from './usersMembersSectionTypes';

const { Text } = Typography;

const resolveRoleTagColor = (roleKey: string) =>
  roleKey === 'owner' ? 'purple' : 'blue';

export default function UsersMemberEditModal({
  canManageMembers,
  editingMember,
  memberAction,
  onClose,
  onMemberAction,
}: {
  canManageMembers: boolean;
  editingMember: WorkspaceMemberRecord | null;
  memberAction: { memberId: string; action: MemberAction } | null;
  onClose: () => void;
  onMemberAction: (memberId: string, action: MemberAction) => void;
}) {
  const editingActions = editingMember
    ? buildMemberLifecycleActions(editingMember)
    : [];
  const memberDetailItems = editingMember
    ? [
        {
          key: 'displayName',
          label: '姓名',
          children: editingMember.user?.displayName || '未命名用户',
        },
        {
          key: 'account',
          label: '账号',
          children: formatAccountLabel(
            editingMember.user?.email,
            editingMember.userId || '—',
          ),
        },
        {
          key: 'email',
          label: '邮箱',
          children: editingMember.user?.email || '—',
        },
        {
          key: 'phone',
          label: '手机号',
          children: formatPhoneLabel(
            editingMember.user?.phone,
            editingMember.user?.mobile,
            editingMember.user?.phoneNumber,
          ),
        },
        {
          key: 'role',
          label: '角色',
          children: (
            <Tag color={resolveRoleTagColor(editingMember.roleKey)}>
              {resolveWorkspaceMemberRoleLabel(editingMember.roleKey)}
            </Tag>
          ),
        },
        {
          key: 'status',
          label: '状态',
          children: (
            <Tag color={applicationStatusColor(editingMember.status)}>
              {STATUS_LABELS[editingMember.status] || editingMember.status}
            </Tag>
          ),
        },
        {
          key: 'source',
          label: '来源',
          children: renderSourceDetails(
            editingMember.sourceDetails,
            resolveMemberSourceFallbackLabel(editingMember.status),
          ),
        },
      ]
    : [];

  return (
    <Modal
      title="编辑用户"
      open={Boolean(editingMember)}
      destroyOnHidden
      footer={null}
      onCancel={onClose}
    >
      {editingMember ? (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions
            bordered
            column={1}
            items={memberDetailItems}
            styles={{
              label: { width: 92, color: 'var(--nova-text-secondary)' },
            }}
          />

          {canManageMembers ? (
            <Space wrap>
              {editingActions.map((action) => {
                const busy =
                  memberAction?.memberId === editingMember.id &&
                  memberAction?.action === action.action;
                return (
                  <Button
                    key={action.action}
                    type={action.buttonType}
                    danger={action.danger}
                    loading={busy}
                    onClick={() => {
                      onMemberAction(editingMember.id, action.action);
                      onClose();
                    }}
                  >
                    {action.label}
                  </Button>
                );
              })}
              {!editingActions.length ? (
                <Text type="secondary">当前账号不支持更多编辑操作。</Text>
              ) : null}
            </Space>
          ) : (
            <Alert type="info" showIcon message="当前账号仅可查看用户详情" />
          )}
        </Space>
      ) : null}
    </Modal>
  );
}
