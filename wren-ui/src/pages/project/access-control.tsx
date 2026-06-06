import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Typography,
  message,
} from 'antd';
import styled from 'styled-components';
import OrganizationSettingsLayout from '@/components/organization/SettingsLayout';
import { LoadingWrapper } from '@/components/PageLoading';

type OrganizationRole = 'Admin' | 'Member';
type ProjectPermission = 'Owner' | 'Contributor' | 'Viewer';

interface ProjectAccessMember {
  id: number;
  userId: number;
  name: string;
  email: string;
  organizationRole: OrganizationRole;
  permission: ProjectPermission;
  isCurrentUser: boolean;
  canEditPermission: boolean;
  canRemove: boolean;
}

interface AvailableProjectMember {
  id: number;
  userId: number;
  name: string;
  email: string;
  organizationRole: OrganizationRole;
}

interface ProjectAccessResponse {
  members: ProjectAccessMember[];
  availableMembers: AvailableProjectMember[];
  currentUserId: number | null;
  canManageAccess: boolean;
  error?: string;
}

const PERMISSION_OPTIONS: ProjectPermission[] = [
  'Owner',
  'Contributor',
  'Viewer',
];

const MembersCard = styled.div`
  margin-top: 16px;
  border: 1px solid var(--gray-4);
  border-radius: 4px;
  background: white;
  overflow: hidden;
`;

const MembersHeaderRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 120px 160px 120px;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--gray-4);
  font-weight: 600;
  color: var(--gray-8);
`;

const MembersRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 120px 160px 120px;
  gap: 16px;
  padding: 16px 20px;
  align-items: center;

  &:not(:last-child) {
    border-bottom: 1px solid var(--gray-4);
  }
`;

const SectionTitle = styled.h4`
  margin: 16px 0 0;
  color: var(--gray-8);
`;

const NameCell = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const InitialsBadge = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #e58dc4;
  color: white;
  font-weight: 600;
`;

const MemberName = styled.div`
  display: flex;
  flex-direction: column;
`;

const MemberEmail = styled.span`
  color: var(--gray-7);
`;

const RoleBadge = styled.span<{ $role: OrganizationRole }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => (props.$role === 'Admin' ? '#6f3ff5' : '#2f6cf6')};
  border: 1px solid
    ${(props) => (props.$role === 'Admin' ? '#8b5cf6' : '#6b8cff')};
  background: ${(props) => (props.$role === 'Admin' ? '#f3ebff' : '#eef4ff')};
`;

const NativeSelect = styled.select`
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--gray-4);
  border-radius: 6px;
  padding: 8px 12px;
  background: white;

  &:disabled {
    background: var(--gray-3);
    color: var(--gray-6);
    cursor: not-allowed;
  }
`;

const ActionArea = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const InlineConfirm = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
`;

const SearchResults = styled.div`
  border: 1px solid var(--gray-4);
  border-radius: 6px;
  background: white;
  overflow: hidden;
  margin-top: 8px;
`;

const SearchResultRow = styled.button<{ $selected?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: none;
  background: ${(props) => (props.$selected ? 'var(--gray-3)' : 'white')};
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--gray-3);
  }
`;

const SearchPlaceholder = styled.div`
  padding: 14px 12px;
  color: var(--gray-7);
`;

const getInitials = (name: string) =>
  (name || 'U')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

export default function ProjectAccessControlPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const [members, setMembers] = useState<ProjectAccessMember[]>([]);
  const [availableMembers, setAvailableMembers] = useState<
    AvailableProjectMember[]
  >([]);
  const [canManageAccess, setCanManageAccess] = useState(false);
  const [confirmingMemberId, setConfirmingMemberId] = useState<number | null>(
    null,
  );

  const memberSearch = Form.useWatch('memberSearch', form) as string | undefined;
  const selectedMemberId = Form.useWatch('organizationMemberId', form) as
    | number
    | undefined;

  const loadAccess = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/projects/access/current');
      const payload = (await response.json()) as ProjectAccessResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load project access');
      }
      setMembers(payload.members || []);
      setAvailableMembers(payload.availableMembers || []);
      setCanManageAccess(Boolean(payload.canManageAccess));
    } catch (error: any) {
      message.error(error.message || 'Failed to load project access');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccess();
  }, []);

  const filteredAvailableMembers = useMemo(() => {
    const keyword = `${memberSearch || ''}`.trim().toLowerCase();
    if (!keyword) {
      return availableMembers;
    }
    return availableMembers.filter((member) =>
      `${member.name} ${member.email}`.toLowerCase().includes(keyword),
    );
  }, [availableMembers, memberSearch]);

  const openAddMemberModal = () => {
    form.resetFields();
    form.setFieldsValue({
      permission: 'Owner',
      memberSearch: '',
    });
    setVisible(true);
  };

  const addMember = async () => {
    try {
      const values = await form.validateFields();
      const response = await fetch('/api/v1/projects/access/current', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organizationMemberId: values.organizationMemberId,
          permission: values.permission,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to add member');
      }
      message.success('Project member added successfully.');
      setVisible(false);
      form.resetFields();
      await loadAccess();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error.message || 'Failed to add member');
    } finally {
      setSaving(false);
    }
  };

  const updatePermission = async (
    memberId: number,
    permission: ProjectPermission,
  ) => {
    try {
      const response = await fetch(`/api/v1/projects/access/${memberId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permission }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update permission');
      }
      setMembers((prev) =>
        prev.map((member) => (member.id === memberId ? payload : member)),
      );
      message.success('Project permission updated successfully.');
    } catch (error: any) {
      message.error(error.message || 'Failed to update permission');
    }
  };

  const removeMember = async (memberId: number) => {
    try {
      const response = await fetch(`/api/v1/projects/access/${memberId}`, {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to remove member');
      }
      setMembers((prev) => prev.filter((member) => member.id !== memberId));
      message.success('Project member removed successfully.');
    } catch (error: any) {
      message.error(error.message || 'Failed to remove member');
    } finally {
      setConfirmingMemberId(null);
    }
  };

  return (
    <OrganizationSettingsLayout
      section="project-access-control"
      title="Access control"
      titleExtra={
        <Button
          type="primary"
          onClick={openAddMemberModal}
          disabled={!canManageAccess}
        >
          Add member
        </Button>
      }
    >
      <LoadingWrapper loading={loading}>
        <div>
          <SectionTitle>Manage access</SectionTitle>
          <MembersCard>
            <MembersHeaderRow>
              <div>Name</div>
              <div>Email</div>
              <div>Organization role</div>
              <div>Permission</div>
              <div />
            </MembersHeaderRow>
            {members.map((member) => (
              <MembersRow key={member.id}>
                <NameCell>
                  <InitialsBadge>{getInitials(member.name)}</InitialsBadge>
                  <MemberName>
                    <span className="text-medium">
                      {member.name}
                      {member.isCurrentUser ? ' (me)' : ''}
                    </span>
                  </MemberName>
                </NameCell>
                <MemberEmail>{member.email}</MemberEmail>
                <RoleBadge $role={member.organizationRole}>
                  {member.organizationRole}
                </RoleBadge>
                <NativeSelect
                  value={member.permission}
                  disabled={!member.canEditPermission || !canManageAccess}
                  onChange={(event) =>
                    void updatePermission(
                      member.id,
                      event.target.value as ProjectPermission,
                    )
                  }
                >
                  {PERMISSION_OPTIONS.map((permission) => (
                    <option key={permission} value={permission}>
                      {permission}
                    </option>
                  ))}
                </NativeSelect>
                <ActionArea>
                  {!member.canRemove || !canManageAccess ? null : confirmingMemberId === member.id ? (
                    <InlineConfirm>
                      <Typography.Text className="gray-8">
                        Are you sure?
                      </Typography.Text>
                      <Button
                        size="small"
                        onClick={() => setConfirmingMemberId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        danger
                        size="small"
                        type="primary"
                        onClick={() => void removeMember(member.id)}
                      >
                        Confirm
                      </Button>
                    </InlineConfirm>
                  ) : (
                    <Button
                      danger
                      type="text"
                      onClick={() => setConfirmingMemberId(member.id)}
                    >
                      Remove
                    </Button>
                  )}
                </ActionArea>
              </MembersRow>
            ))}
          </MembersCard>
        </div>
      </LoadingWrapper>

      <Modal
        title="Add member"
        visible={visible}
        onCancel={() => {
          setVisible(false);
          form.resetFields();
        }}
        onOk={() => {
          setSaving(true);
          void addMember();
        }}
        confirmLoading={saving}
        okText="Add"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="organizationMemberId"
            rules={[{ required: true, message: 'Select a member' }]}
            hidden
          >
            <Input />
          </Form.Item>

          <Form.Item label="Member" className="mb-2">
            <Input
              placeholder="Select a member"
              value={
                selectedMemberId
                  ? availableMembers.find((member) => member.id === selectedMemberId)
                      ?.name || ''
                  : ''
              }
              readOnly
            />
          </Form.Item>

          <Form.Item
            name="memberSearch"
            className="mb-3"
            validateStatus={!selectedMemberId ? 'error' : undefined}
            help={!selectedMemberId ? 'Select a member' : undefined}
          >
            <Input placeholder="Search members" />
          </Form.Item>

          <SearchResults>
            {filteredAvailableMembers.length ? (
              filteredAvailableMembers.map((member) => (
                <SearchResultRow
                  key={member.id}
                  type="button"
                  $selected={selectedMemberId === member.id}
                  onClick={() => form.setFieldsValue({ organizationMemberId: member.id })}
                >
                  <InitialsBadge>{getInitials(member.name)}</InitialsBadge>
                  <MemberName>
                    <span className="text-medium">{member.name}</span>
                    <MemberEmail>{member.email}</MemberEmail>
                  </MemberName>
                </SearchResultRow>
              ))
            ) : (
              <SearchPlaceholder>
                No organization members are available to add.
              </SearchPlaceholder>
            )}
          </SearchResults>

          <Form.Item
            label="Permission"
            name="permission"
            initialValue="Owner"
            className="mt-4 mb-0"
            rules={[{ required: true, message: 'Permission is required' }]}
          >
            <NativeSelect>
              {PERMISSION_OPTIONS.map((permission) => (
                <option key={permission} value={permission}>
                  {permission}
                </option>
              ))}
            </NativeSelect>
          </Form.Item>
        </Form>
      </Modal>
    </OrganizationSettingsLayout>
  );
}
