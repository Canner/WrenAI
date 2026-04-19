import { useMemo, useState } from 'react';
import { Button, Card, Space, Table, Tag, Tooltip, Typography } from 'antd';

import EditOutlined from '@ant-design/icons/EditOutlined';
import SwapOutlined from '@ant-design/icons/SwapOutlined';
import { formatUserLabel } from '@/features/settings/workspaceGovernanceShared';

const { Text } = Typography;
import {
  ROLE_LABELS,
  STATUS_LABELS,
  applicationStatusColor,
  formatAccountLabel,
  formatPhoneLabel,
  getRoleAdjustmentDisabledReason,
} from './usersPageUtils';
import UsersMembersToolbar from './UsersMembersToolbar';
import UsersMemberInviteModal from './UsersMemberInviteModal';
import UsersMemberEditModal from './UsersMemberEditModal';
import UsersMemberRoleModal from './UsersMemberRoleModal';
import {
  type MemberAction,
  type WorkspaceMemberRecord,
} from './usersMembersSectionTypes';

const resolveRoleTagColor = (roleKey: string) =>
  roleKey === 'owner' ? 'purple' : roleKey === 'admin' ? 'gold' : 'blue';

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

  const handleInviteSubmit = async () => {
    const success = await onInviteMember();
    if (success) {
      setInviteModalOpen(false);
    }
  };

  const openRoleModal = (member: WorkspaceMemberRecord) => {
    setRoleTargetMember(member);
    setNextRoleKey(member.roleKey || 'member');
  };

  return (
    <Card title="用户列表">
      <UsersMembersToolbar
        canManageMembers={canManageMembers}
        filteredCount={filteredMembers.length}
        keyword={keyword}
        memberCount={memberCount}
        reviewQueueCount={reviewQueueCount}
        roleFilter={roleFilter}
        setInviteModalOpen={setInviteModalOpen}
        setKeyword={setKeyword}
        setRoleFilter={setRoleFilter}
        setStatusFilter={setStatusFilter}
        statusFilter={statusFilter}
        totalCount={members.length}
      />

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
              <Tag color={resolveRoleTagColor(roleKey)}>
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

      <UsersMemberInviteModal
        canManageMembers={canManageMembers}
        inviteEmail={inviteEmail}
        inviteLoading={inviteLoading}
        inviteModalOpen={inviteModalOpen}
        inviteRole={inviteRole}
        onClose={() => setInviteModalOpen(false)}
        onInviteEmailChange={onInviteEmailChange}
        onInviteRoleChange={onInviteRoleChange}
        onSubmit={() => {
          void handleInviteSubmit();
        }}
      />

      <UsersMemberEditModal
        canManageMembers={canManageMembers}
        editingMember={editingMember}
        memberAction={memberAction}
        onClose={() => setEditingMember(null)}
        onMemberAction={(memberId, action) => onMemberAction(memberId, action)}
      />

      <UsersMemberRoleModal
        canManageMembers={canManageMembers}
        memberAction={memberAction}
        nextRoleKey={nextRoleKey}
        onClose={() => setRoleTargetMember(null)}
        onMemberAction={onMemberAction}
        roleTargetMember={roleTargetMember}
        setNextRoleKey={setNextRoleKey}
      />
    </Card>
  );
}
