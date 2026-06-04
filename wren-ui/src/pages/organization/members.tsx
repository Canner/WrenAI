import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  message,
} from 'antd';
import styled from 'styled-components';
import OrganizationSettingsLayout from '@/components/organization/SettingsLayout';
import { LoadingWrapper } from '@/components/PageLoading';
import { getRelativeTime } from '@/utils/time';

type OrganizationRole = 'Admin' | 'Member';
type ProjectPermissionRole = 'Owner' | 'Editor' | 'Viewer';
type InvitationStatus = 'Pending' | 'Accepted' | 'Expired';

interface ProjectOption {
  id: number;
  displayName: string;
}

interface MemberProject {
  projectId: number;
  displayName: string;
  permission: ProjectPermissionRole;
}

interface MemberRecord {
  id: number;
  userId: number;
  name: string;
  email: string;
  organizationRole: OrganizationRole;
  projects: MemberProject[];
}

interface PendingInviteRecord {
  id: number;
  email: string;
  organizationRole: OrganizationRole;
  status: InvitationStatus;
  token: string;
  inviteLink: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
  projects: MemberProject[];
}

interface MembersResponse {
  members: MemberRecord[];
  invitations: PendingInviteRecord[];
  projects: ProjectOption[];
  currentUserId: number | null;
  error?: string;
}

const ROLE_OPTIONS = ['Admin', 'Member'];
const PROJECT_PERMISSION_OPTIONS = ['Owner', 'Editor', 'Viewer'];

const MembersCard = styled.div`
  margin-top: 16px;
  border: 1px solid var(--gray-4);
  border-radius: 4px;
  background: white;
  overflow: hidden;
`;

const MembersHeaderRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 180px 120px;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--gray-4);
  font-weight: 600;
  color: var(--gray-8);
`;

const MembersRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 180px 120px;
  gap: 16px;
  padding: 16px 20px;
  align-items: center;

  &:not(:last-child) {
    border-bottom: 1px solid var(--gray-4);
  }
`;

const ProjectsBox = styled.div`
  border: 1px solid var(--gray-4);
  border-radius: 4px;
  background: white;
  overflow: hidden;
`;

const ProjectsToolbar = styled.div`
  padding: 12px 12px 0;
`;

const ProjectRow = styled.div`
  display: grid;
  grid-template-columns: 28px 1fr 140px;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-top: 1px solid var(--gray-4);
`;

const ProjectHeader = styled(ProjectRow)`
  background: var(--gray-3);
  font-weight: 600;
`;

const EmptyProjectsRow = styled.div`
  padding: 16px 12px;
  border-top: 1px solid var(--gray-4);
  color: var(--gray-7);
`;

const ProjectCheckbox = styled.input`
  width: 16px;
  height: 16px;
  cursor: pointer;
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

const ModalLabel = styled.div`
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--gray-8);
`;

const SectionTitle = styled.h4`
  margin: 16px 0 0;
  color: var(--gray-8);
`;

const PendingHeaderRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) 120px 140px minmax(0, 1.4fr) 80px;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--gray-4);
  font-weight: 600;
  color: var(--gray-8);
`;

const PendingRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) 120px 140px minmax(0, 1.4fr) 80px;
  gap: 16px;
  padding: 16px 20px;
  align-items: center;

  &:not(:last-child) {
    border-bottom: 1px solid var(--gray-4);
  }
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
  background: #c27ba0;
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

const InviteLinkRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const InviteLinkInput = styled.input`
  width: 100%;
  min-height: 32px;
  border: 1px solid var(--gray-4);
  border-radius: 6px;
  padding: 6px 10px;
  background: white;
`;

const StatusBadge = styled.span<{ $status: InvitationStatus }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: ${(props) =>
    props.$status === 'Pending'
      ? '#4e9f2d'
      : props.$status === 'Accepted'
        ? '#1d70b8'
        : '#c2410c'};
  background: ${(props) =>
    props.$status === 'Pending'
      ? '#f0f9e8'
      : props.$status === 'Accepted'
        ? '#eaf4ff'
        : '#fff3e8'};
  border: 1px solid
    ${(props) =>
      props.$status === 'Pending'
        ? '#9ed270'
        : props.$status === 'Accepted'
          ? '#9cc9f5'
          : '#fdba74'};
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

const getInitials = (name: string) =>
  (name || 'U')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

const buildProjectSelectionMap = (
  projects: ProjectOption[],
  organizationRole: OrganizationRole,
) => {
  if (organizationRole === 'Admin') {
    return projects.reduce<Record<number, ProjectPermissionRole>>((acc, project) => {
      acc[project.id] = 'Owner';
      return acc;
    }, {});
  }
  return {};
};

export default function OrganizationMembersPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingMemberId, setUpdatingMemberId] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [invitations, setInvitations] = useState<PendingInviteRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [confirmingMemberId, setConfirmingMemberId] = useState<number | null>(null);
  const [confirmingInviteId, setConfirmingInviteId] = useState<number | null>(null);
  const [projectSelections, setProjectSelections] = useState<
    Record<number, ProjectPermissionRole>
  >({});
  const organizationRole = Form.useWatch(
    'organizationRole',
    form,
  ) as OrganizationRole | undefined;
  const projectSearch = Form.useWatch('projectSearch', form) as string | undefined;

  const loadMembers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/organizations/members');
      const payload = (await response.json()) as MembersResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load members');
      }
      setMembers(payload.members || []);
      setInvitations(payload.invitations || []);
      setProjects(payload.projects || []);
      setCurrentUserId(payload.currentUserId ?? null);
    } catch (error: any) {
      message.error(error.message || 'Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMembers();
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (organizationRole === 'Admin') {
      setProjectSelections(buildProjectSelectionMap(projects, organizationRole));
      return;
    }
    setProjectSelections({});
  }, [organizationRole, visible, projects]);

  const openInviteModal = () => {
    form.resetFields();
    form.setFieldsValue({
      organizationRole: 'Admin',
      projectSearch: '',
    });
    setProjectSelections(buildProjectSelectionMap(projects, 'Admin'));
    setVisible(true);
  };

  const filteredProjects = useMemo(() => {
    const search = `${projectSearch || ''}`.trim().toLowerCase();
    return projects.filter((project) =>
      !search
        ? true
        : project.displayName.toLowerCase().includes(search),
    );
  }, [projects, projectSearch]);

  const toggleProject = (projectId: number, checked: boolean) => {
    setProjectSelections((prev) => {
      const next = { ...prev };
      if (checked) {
        next[projectId] = next[projectId] || 'Owner';
      } else {
        delete next[projectId];
      }
      return next;
    });
  };

  const updateProjectPermission = (
    projectId: number,
    permission: ProjectPermissionRole,
  ) => {
    setProjectSelections((prev) => ({
      ...prev,
      [projectId]: permission,
    }));
  };

  const inviteMember = async () => {
    try {
      const values = await form.validateFields();
      const response = await fetch('/api/v1/organizations/members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: values.email,
          organizationRole: values.organizationRole,
          projects: Object.entries(projectSelections).map(
            ([projectId, permission]) => ({
              projectId: Number(projectId),
              permission,
            }),
          ),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to invite member');
      }
      message.success('Member invited successfully.');
      setVisible(false);
      form.resetFields();
      setProjectSelections({});
      await loadMembers();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error.message || 'Failed to invite member');
    } finally {
      setSaving(false);
    }
  };

  const updateMemberRole = async (
    memberId: number,
    organizationRole: OrganizationRole,
  ) => {
    try {
      setUpdatingMemberId(memberId);
      const response = await fetch(`/api/v1/organizations/members/${memberId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ organizationRole }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update member');
      }
      setMembers((prev) =>
        prev.map((member) =>
          member.id === memberId
            ? { ...member, organizationRole: payload.organizationRole }
            : member,
        ),
      );
      message.success('Member role updated successfully.');
    } catch (error: any) {
      message.error(error.message || 'Failed to update member');
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const removeMember = async (memberId: number) => {
    try {
      setUpdatingMemberId(memberId);
      const response = await fetch(`/api/v1/organizations/members/${memberId}`, {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to remove member');
      }
      setMembers((prev) => prev.filter((member) => member.id !== memberId));
      message.success('Member removed successfully.');
    } catch (error: any) {
      message.error(error.message || 'Failed to remove member');
    } finally {
      setUpdatingMemberId(null);
      setConfirmingMemberId(null);
    }
  };

  const removeInvitation = async (invitationId: number) => {
    try {
      const response = await fetch(
        `/api/v1/organizations/invitations/${invitationId}`,
        {
          method: 'DELETE',
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to remove invitation');
      }
      setInvitations((prev) =>
        prev.filter((invitation) => invitation.id !== invitationId),
      );
      message.success('Invitation removed successfully.');
    } catch (error: any) {
      message.error(error.message || 'Failed to remove invitation');
    } finally {
      setConfirmingInviteId(null);
    }
  };

  const copyInviteLink = async (inviteLink: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      message.success('Invitation link copied.');
    } catch {
      message.error('Failed to copy invitation link');
    }
  };

  return (
    <OrganizationSettingsLayout
      section="members"
      title="Members"
      titleExtra={
        <Button type="primary" onClick={openInviteModal}>
          Invite people
        </Button>
      }
    >
      <LoadingWrapper loading={loading}>
        <div>
          <SectionTitle>Pending invites</SectionTitle>
          <MembersCard>
            <PendingHeaderRow>
              <div>Invitee</div>
              <div>Status</div>
              <div>Created</div>
              <div>Invite link</div>
              <div />
            </PendingHeaderRow>
            {invitations.length ? (
              invitations.map((invitation) => (
                <PendingRow key={invitation.id}>
                  <NameCell>
                    <InitialsBadge>
                      {getInitials(invitation.email.split('@')[0])}
                    </InitialsBadge>
                    <div>{invitation.email}</div>
                  </NameCell>
                  <StatusBadge $status={invitation.status}>
                    {invitation.status}
                  </StatusBadge>
                  <div>{getRelativeTime(invitation.createdAt)}</div>
                  <InviteLinkRow>
                    <InviteLinkInput
                      value={invitation.inviteLink}
                      readOnly
                    />
                    <Button onClick={() => void copyInviteLink(invitation.inviteLink)}>
                      Copy
                    </Button>
                  </InviteLinkRow>
                  <ActionArea>
                    {confirmingInviteId === invitation.id ? (
                      <InlineConfirm>
                        <Button
                          size="small"
                          onClick={() => setConfirmingInviteId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          danger
                          size="small"
                          type="primary"
                          onClick={() => void removeInvitation(invitation.id)}
                        >
                          Confirm
                        </Button>
                      </InlineConfirm>
                    ) : (
                      <Button
                        danger
                        type="text"
                        onClick={() => setConfirmingInviteId(invitation.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </ActionArea>
                </PendingRow>
              ))
            ) : (
              <PendingRow>
                <div className="gray-7">No pending invitations</div>
                <div />
                <div />
                <div />
                <div />
              </PendingRow>
            )}
          </MembersCard>

          <SectionTitle>Organization members</SectionTitle>
          <MembersCard>
            <MembersHeaderRow>
              <div>Name</div>
              <div>Email</div>
              <div>Role</div>
              <div>Actions</div>
            </MembersHeaderRow>
            {members.map((member) => (
              <MembersRow key={member.id}>
                <NameCell>
                  <InitialsBadge>{getInitials(member.name)}</InitialsBadge>
                  <MemberName>
                    <span className="text-medium">
                      {member.name}
                      {member.userId === currentUserId ? ' (me)' : ''}
                    </span>
                  </MemberName>
                </NameCell>
                <MemberEmail>{member.email}</MemberEmail>
                <NativeSelect
                  value={member.organizationRole}
                  disabled={
                    updatingMemberId === member.id ||
                    member.userId === currentUserId
                  }
                  onChange={(event) =>
                    void updateMemberRole(
                      member.id,
                      event.target.value as OrganizationRole,
                    )
                  }
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </NativeSelect>
                <ActionArea>
                  {member.userId === currentUserId ? null : confirmingMemberId === member.id ? (
                    <InlineConfirm>
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
                        disabled={updatingMemberId === member.id}
                        onClick={() => void removeMember(member.id)}
                      >
                        Confirm
                      </Button>
                    </InlineConfirm>
                  ) : (
                    <Button
                      danger
                      type="text"
                      disabled={updatingMemberId === member.id}
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
        title="Invite people"
        visible={visible}
        onCancel={() => {
          setVisible(false);
          setProjectSelections({});
          form.resetFields();
        }}
        onOk={() => {
          setSaving(true);
          void inviteMember();
        }}
        confirmLoading={saving}
        okText="Invite"
        destroyOnClose
        width={720}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: true, message: 'Email is required' },
              { type: 'email', message: 'Enter a valid email address' },
            ]}
          >
            <Input placeholder="user@example.com" />
          </Form.Item>

          <Form.Item
            label="Organization role"
            name="organizationRole"
            rules={[{ required: true, message: 'Organization role is required' }]}
          >
            <NativeSelect>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </NativeSelect>
          </Form.Item>

          <Form.Item label="Select projects" required>
            <ProjectsBox>
              <ProjectsToolbar>
                <ModalLabel>
                  {Object.keys(projectSelections).length}/{projects.length} project(s)
                </ModalLabel>
                <Form.Item name="projectSearch" className="mt-2 mb-3">
                  <Input placeholder="Search here" />
                </Form.Item>
              </ProjectsToolbar>

              <ProjectHeader>
                <div />
                <div>Project name</div>
                <div>Permission</div>
              </ProjectHeader>

              {filteredProjects.map((project) => {
                const checked = Boolean(projectSelections[project.id]);
                const permission = projectSelections[project.id] || 'Owner';
                return (
                  <ProjectRow key={project.id}>
                    <ProjectCheckbox
                      type="checkbox"
                      checked={checked}
                      disabled={organizationRole === 'Admin'}
                      onChange={(event) =>
                        toggleProject(project.id, event.target.checked)
                      }
                    />
                    <div>{project.displayName}</div>
                    <NativeSelect
                      value={permission}
                      disabled={!checked || organizationRole === 'Admin'}
                      onChange={(event) =>
                        updateProjectPermission(
                          project.id,
                          event.target.value as ProjectPermissionRole,
                        )
                      }
                    >
                      {PROJECT_PERMISSION_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </NativeSelect>
                  </ProjectRow>
                );
              })}
              {!filteredProjects.length && (
                <EmptyProjectsRow>
                  {projects.length
                    ? 'No projects match your search.'
                    : 'No projects are available for this organization yet.'}
                </EmptyProjectsRow>
              )}
            </ProjectsBox>
          </Form.Item>
        </Form>
      </Modal>
    </OrganizationSettingsLayout>
  );
}
