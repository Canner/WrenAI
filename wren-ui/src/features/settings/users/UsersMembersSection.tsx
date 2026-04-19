import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Row,
  Col,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import EditOutlined from '@ant-design/icons/EditOutlined';
import SwapOutlined from '@ant-design/icons/SwapOutlined';
import UserAddOutlined from '@ant-design/icons/UserAddOutlined';
import {
  ROLE_OPTIONS,
  formatUserLabel,
} from '@/features/settings/workspaceGovernanceShared';
import {
  ROLE_LABELS,
  STATUS_LABELS,
  applicationStatusColor,
  formatAccountLabel,
  formatPhoneLabel,
  getRoleAdjustmentDisabledReason,
  isRoleProtectedFromAdjustment,
  renderSourceDetails,
  type SourceDetail,
} from './usersPageUtils';

const { Text } = Typography;

type MemberAction =
  | 'approve'
  | 'reject'
  | 'updateRole'
  | 'deactivate'
  | 'reactivate'
  | 'remove';

type MemberLifecycleActionConfig = {
  action: MemberAction;
  label: string;
  buttonType?: 'primary' | 'default';
  danger?: boolean;
};

type WorkspaceMemberRecord = {
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

const buildMemberLifecycleActions = (
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

const ROLE_FILTER_OPTIONS = [
  { label: '全部角色', value: 'all' },
  ...ROLE_OPTIONS,
].map((option) => ({ ...option, key: option.value }));

const STATUS_FILTER_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: STATUS_LABELS.active, value: 'active' },
  { label: STATUS_LABELS.pending, value: 'pending' },
  { label: STATUS_LABELS.invited, value: 'invited' },
  { label: STATUS_LABELS.inactive, value: 'inactive' },
  { label: STATUS_LABELS.rejected, value: 'rejected' },
];

export default function UsersMembersSection({
  loading,
  memberCount,
  reviewQueueCount,
  canManageMembers,
  inviteEmail,
  inviteRole,
  inviteLoading,
  members,
  memberAction,
  onInviteEmailChange,
  onInviteRoleChange,
  onInviteMember,
  onMemberAction,
}: {
  loading: boolean;
  memberCount: number;
  reviewQueueCount: number;
  canManageMembers: boolean;
  inviteEmail: string;
  inviteRole: string;
  inviteLoading: boolean;
  members: WorkspaceMemberRecord[];
  memberAction: { memberId: string; action: MemberAction } | null;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: string) => void;
  onInviteMember: () => Promise<boolean> | boolean;
  onMemberAction: (
    memberId: string,
    action: MemberAction,
    extra?: Record<string, any>,
  ) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all');
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [editingMember, setEditingMember] =
    useState<WorkspaceMemberRecord | null>(null);
  const [roleTargetMember, setRoleTargetMember] =
    useState<WorkspaceMemberRecord | null>(null);
  const [nextRoleKey, setNextRoleKey] = useState('member');

  const filteredMembers = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return members.filter((member) => {
      if (roleFilter !== 'all' && member.roleKey !== roleFilter) {
        return false;
      }

      if (statusFilter !== 'all' && member.status !== statusFilter) {
        return false;
      }

      if (!normalizedKeyword) {
        return true;
      }

      const phoneLabel = formatPhoneLabel(
        member.user?.phone,
        member.user?.mobile,
        member.user?.phoneNumber,
      );
      const keywordSource = [
        member.user?.displayName,
        member.user?.email,
        formatAccountLabel(member.user?.email, member.userId || '—'),
        phoneLabel === '—' ? '' : phoneLabel,
        member.userId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return keywordSource.includes(normalizedKeyword);
    });
  }, [keyword, members, roleFilter, statusFilter]);

  const resetFilters = () => {
    setKeyword('');
    setRoleFilter('all');
    setStatusFilter('all');
  };

  const openRoleModal = (member: WorkspaceMemberRecord) => {
    setRoleTargetMember(member);
    setNextRoleKey(member.roleKey || 'member');
  };

  const handleInviteSubmit = async () => {
    const success = await onInviteMember();
    if (success) {
      setInviteModalOpen(false);
    }
  };

  const roleChangeDisabledReason = roleTargetMember
    ? getRoleAdjustmentDisabledReason(roleTargetMember.roleKey)
    : null;
  const editingActions = editingMember
    ? buildMemberLifecycleActions(editingMember)
    : [];

  return (
    <Card
      title="用户列表"
      extra={
        canManageMembers ? (
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={() => setInviteModalOpen(true)}
          >
            新增用户
          </Button>
        ) : null
      }
    >
      <Row
        justify="space-between"
        gutter={[12, 12]}
        style={{ marginBottom: 16 }}
      >
        <Col flex="auto">
          <Space size={10} wrap>
            <Input.Search
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索姓名 / 账号 / 手机号"
              style={{ width: 300 }}
            />
            <Select
              value={roleFilter}
              options={ROLE_FILTER_OPTIONS}
              style={{ width: 140 }}
              onChange={(value) => setRoleFilter(value)}
            />
            <Select
              value={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              style={{ width: 140 }}
              onChange={(value) => setStatusFilter(value)}
            />
            <Button onClick={resetFilters}>重置</Button>
          </Space>
        </Col>
      </Row>

      {!canManageMembers ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="当前为只读视图"
          description="你可以查看用户信息与角色分布；编辑用户、调整角色与新增用户仍需要 workspace.member 管理权限。"
        />
      ) : null}

      <Space style={{ marginBottom: 12 }} wrap>
        <Text type="secondary">
          已显示 {filteredMembers.length} / {members.length} 名用户
        </Text>
        <Tag color="default">总用户 {memberCount}</Tag>
        <Tag color="default">待处理 {reviewQueueCount}</Tag>
        {roleFilter !== 'all' ? (
          <Tag color="blue">角色：{ROLE_LABELS[roleFilter] || roleFilter}</Tag>
        ) : null}
        {statusFilter !== 'all' ? (
          <Tag color={applicationStatusColor(statusFilter)}>
            状态：{STATUS_LABELS[statusFilter] || statusFilter}
          </Tag>
        ) : null}
      </Space>

      <Table
        className="console-table"
        rowKey="id"
        loading={loading}
        pagination={{
          pageSize: 10,
          hideOnSinglePage: true,
        }}
        locale={{ emptyText: '当前没有匹配的用户记录' }}
        dataSource={filteredMembers}
        columns={[
          {
            title: '姓名',
            dataIndex: ['user', 'displayName'],
            width: 180,
            render: (_value: unknown, record: WorkspaceMemberRecord) => (
              <Text strong>
                {formatUserLabel(
                  record.user?.displayName,
                  undefined,
                  '未命名用户',
                )}
              </Text>
            ),
          },
          {
            title: '账号',
            key: 'account',
            width: 220,
            render: (_value: unknown, record: WorkspaceMemberRecord) => (
              <Space direction="vertical" size={0}>
                <Text>
                  {formatAccountLabel(record.user?.email, record.userId || '—')}
                </Text>
                <Text type="secondary">{record.user?.email || '—'}</Text>
              </Space>
            ),
          },
          {
            title: '手机号',
            key: 'phone',
            width: 150,
            render: (_value: unknown, record: WorkspaceMemberRecord) =>
              formatPhoneLabel(
                record.user?.phone,
                record.user?.mobile,
                record.user?.phoneNumber,
              ),
          },
          {
            title: '角色',
            dataIndex: 'roleKey',
            width: 120,
            render: (roleKey: string) => (
              <Tag
                color={
                  roleKey === 'owner'
                    ? 'purple'
                    : roleKey === 'admin'
                      ? 'gold'
                      : 'blue'
                }
              >
                {ROLE_LABELS[roleKey] || roleKey}
              </Tag>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 110,
            render: (status: string) => (
              <Tag color={applicationStatusColor(status)}>
                {STATUS_LABELS[status] || status}
              </Tag>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 220,
            render: (_value: unknown, record: WorkspaceMemberRecord) => {
              const adjustRoleDisabledReason = getRoleAdjustmentDisabledReason(
                record.roleKey,
              );
              const adjustRoleDisabled =
                !canManageMembers || Boolean(adjustRoleDisabledReason);
              const updateBusy =
                memberAction?.memberId === record.id &&
                memberAction?.action === 'updateRole';

              return (
                <Space wrap size={8}>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => setEditingMember(record)}
                  >
                    编辑
                  </Button>
                  <Tooltip title={adjustRoleDisabledReason || undefined}>
                    <span>
                      <Button
                        icon={<SwapOutlined />}
                        disabled={adjustRoleDisabled}
                        loading={updateBusy}
                        onClick={() => openRoleModal(record)}
                      >
                        调整角色
                      </Button>
                    </span>
                  </Tooltip>
                </Space>
              );
            },
          },
        ]}
      />

      <Modal
        title="新增用户"
        visible={inviteModalOpen}
        destroyOnClose
        onCancel={() => setInviteModalOpen(false)}
        onOk={() => {
          void handleInviteSubmit();
        }}
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

      <Modal
        title="编辑用户"
        visible={Boolean(editingMember)}
        destroyOnClose
        footer={null}
        onCancel={() => setEditingMember(null)}
      >
        {editingMember ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions
              bordered
              column={1}
              labelStyle={{ width: 92, color: 'var(--nova-text-secondary)' }}
            >
              <Descriptions.Item label="姓名">
                {editingMember.user?.displayName || '未命名用户'}
              </Descriptions.Item>
              <Descriptions.Item label="账号">
                {formatAccountLabel(
                  editingMember.user?.email,
                  editingMember.userId || '—',
                )}
              </Descriptions.Item>
              <Descriptions.Item label="邮箱">
                {editingMember.user?.email || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="手机号">
                {formatPhoneLabel(
                  editingMember.user?.phone,
                  editingMember.user?.mobile,
                  editingMember.user?.phoneNumber,
                )}
              </Descriptions.Item>
              <Descriptions.Item label="角色">
                <Tag
                  color={
                    editingMember.roleKey === 'owner'
                      ? 'purple'
                      : editingMember.roleKey === 'admin'
                        ? 'gold'
                        : 'blue'
                  }
                >
                  {ROLE_LABELS[editingMember.roleKey] || editingMember.roleKey}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={applicationStatusColor(editingMember.status)}>
                  {STATUS_LABELS[editingMember.status] || editingMember.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="来源">
                {renderSourceDetails(
                  editingMember.sourceDetails,
                  editingMember.status === 'pending'
                    ? '待审批'
                    : editingMember.status === 'invited'
                      ? '邀请待接受'
                      : '成员状态变更',
                )}
              </Descriptions.Item>
            </Descriptions>

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
                        setEditingMember(null);
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

      <Modal
        title="调整角色"
        visible={Boolean(roleTargetMember)}
        destroyOnClose
        onCancel={() => setRoleTargetMember(null)}
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
          setRoleTargetMember(null);
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
                disabled={
                  !canManageMembers || Boolean(roleChangeDisabledReason)
                }
                onChange={setNextRoleKey}
              />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </Card>
  );
}
