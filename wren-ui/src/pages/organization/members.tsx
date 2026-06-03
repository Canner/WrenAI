import { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Table,
  TableColumnsType,
  Typography,
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

const NameCell = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const MemberName = styled.div`
  display: flex;
  flex-direction: column;
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

  const columns: TableColumnsType<MemberRecord> = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (_value, record: MemberRecord) => (
        <NameCell>
          <Avatar style={{ backgroundColor: '#c27ba0' }}>
            {getInitials(record.name)}
          </Avatar>
          <MemberName>
            <span className="text-medium">{record.name}</span>
            <Typography.Text className="gray-7">
              {record.email}
            </Typography.Text>
          </MemberName>
        </NameCell>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'organizationRole',
      width: 220,
      render: (value: OrganizationRole, record: MemberRecord) => (
        <Select
          value={value}
          style={{ width: 140 }}
          loading={updatingMemberId === record.id}
          options={ROLE_OPTIONS.map((role) => ({ label: role, value: role }))}
          onChange={(nextValue) =>
            void updateMemberRole(record.id, nextValue as OrganizationRole)
          }
        />
      ),
    },
  ];

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
          <Typography.Title level={4} className="mt-4 mb-0 gray-8">
            Organization members
          </Typography.Title>
          <MembersCard>
            <Table
              rowKey="id"
              columns={columns}
              dataSource={members}
              pagination={false}
            />
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
            <Select
              options={ROLE_OPTIONS.map((role) => ({
                label: role,
                value: role,
              }))}
            />
          </Form.Item>

          <Form.Item label="Select projects" required>
            <ProjectsBox>
              <ProjectsToolbar>
                <Typography.Text className="gray-8">
                  {Object.keys(projectSelections).length}/{projects.length} project(s)
                </Typography.Text>
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
                    <Select
                      value={permission}
                      disabled={!checked}
                      options={PROJECT_PERMISSION_OPTIONS.map((role) => ({
                        label: role,
                        value: role,
                      }))}
                      onChange={(value) =>
                        updateProjectPermission(
                          project.id,
                          value as ProjectPermissionRole,
                        )
                      }
                    />
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
