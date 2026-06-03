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

type OrganizationRole = 'Admin' | 'Member';
type ProjectPermissionRole = 'Owner' | 'Editor' | 'Viewer';

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

interface MembersResponse {
  members: MemberRecord[];
  projects: ProjectOption[];
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
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--gray-4);
  font-weight: 600;
  color: var(--gray-8);
`;

const MembersRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
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
  const [projects, setProjects] = useState<ProjectOption[]>([]);
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
      setProjects(payload.projects || []);
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
    }
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
          <h4 className="mt-4 mb-0 gray-8">Organization members</h4>
          <MembersCard>
            <MembersHeaderRow>
              <div>Name</div>
              <div>Role</div>
            </MembersHeaderRow>
            {members.map((member) => (
              <MembersRow key={member.id}>
                <NameCell>
                  <InitialsBadge>{getInitials(member.name)}</InitialsBadge>
                  <MemberName>
                    <span className="text-medium">{member.name}</span>
                    <MemberEmail>{member.email}</MemberEmail>
                  </MemberName>
                </NameCell>
                <NativeSelect
                  value={member.organizationRole}
                  disabled={updatingMemberId === member.id}
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
                      onChange={(event) =>
                        toggleProject(project.id, event.target.checked)
                      }
                    />
                    <div>{project.displayName}</div>
                    <NativeSelect
                      value={permission}
                      disabled={!checked}
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
            </ProjectsBox>
          </Form.Item>
        </Form>
      </Modal>
    </OrganizationSettingsLayout>
  );
}
