import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dropdown,
  Form,
  Input,
  message,
  Modal,
  Radio,
  Space,
  Spin,
  Tooltip,
  Typography,
} from 'antd';
import styled from 'styled-components';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import { WorkspaceProjectType } from '@/apollo/client/graphql/__types__';

interface OrganizationRecord {
  id: number;
  name: string;
  identifier: string;
  description?: string | null;
  isCurrent: boolean;
}

interface OrganizationResponse {
  organizations: OrganizationRecord[];
  currentOrganization: OrganizationRecord | null;
  currentProjectName: string;
}

interface ProjectRecord {
  id: number;
  displayName: string;
  projectType: WorkspaceProjectType;
  isCurrent: boolean;
  hasDataSource: boolean;
}

interface ProjectResponse {
  projects: ProjectRecord[];
  currentProject: ProjectRecord | null;
}

const TriggerButton = styled(Button)`
  display: flex;
  align-items: center;
  color: var(--gray-2);
  border: none;
  background: transparent;
  padding: 0 8px;

  &:hover,
  &:focus {
    color: var(--gray-1);
    background: rgba(255, 255, 255, 0.05);
  }
`;

const OrganizationBadge = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #b7eb8f;
  color: #274916;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  text-transform: uppercase;
`;

const Overlay = styled.div`
  width: 280px;
  background: var(--gray-1);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
  overflow: hidden;
`;

const OverlayHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
`;

const OverlayLabel = styled.div`
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--gray-6);
  text-transform: uppercase;
`;

const OverlayBody = styled.div`
  padding: 0 8px 8px;
`;

const OverlayFooter = styled.div`
  border-top: 1px solid var(--gray-4);
  padding: 8px;
`;

const MenuRow = styled.button<{ $active?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border: none;
  background: ${(props) => (props.$active ? 'var(--gray-3)' : 'transparent')};
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--gray-3);
  }
`;

const SectionLabel = styled.div`
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--gray-6);
  text-transform: uppercase;
  margin: 12px 8px 8px;
`;

const SearchBox = styled(Input)`
  margin-bottom: 10px;
`;

const ProjectTypeTag = styled.span`
  font-size: 12px;
  color: var(--gray-6);
`;

const ProjectCard = styled.button<{ $selected?: boolean }>`
  width: 100%;
  text-align: left;
  border: 1px solid ${(props) => (props.$selected ? '#3b59e6' : 'var(--gray-4)')};
  border-radius: 12px;
  padding: 16px;
  background: ${(props) => (props.$selected ? 'rgba(59, 89, 230, 0.04)' : '#fff')};
  cursor: pointer;
`;

const ProjectOptionRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const getBadgeText = (name?: string) =>
  (name || 'O')
    .trim()
    .split(/\s+/)
    .slice(0, 1)
    .map((segment) => segment[0])
    .join('')
    .toUpperCase();

export default function OrganizationSwitcher() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const [projectModalVisible, setProjectModalVisible] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProjectType, setSelectedProjectType] =
    useState<WorkspaceProjectType>(WorkspaceProjectType.AGENTIC);
  const [currentProjectName, setCurrentProjectName] = useState('Default Project');
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [currentOrganization, setCurrentOrganization] =
    useState<OrganizationRecord | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);

  const loadOrganizations = async () => {
    setLoading(true);
    try {
      const [organizationResponse, projectResponse] = await Promise.all([
        fetch('/api/v1/organizations/current'),
        fetch('/api/v1/projects/current'),
      ]);
      const organizationPayload = (await organizationResponse.json()) as OrganizationResponse & {
        error?: string;
      };
      const projectPayload = (await projectResponse.json()) as ProjectResponse & {
        error?: string;
      };
      if (!organizationResponse.ok) {
        throw new Error(
          organizationPayload.error || 'Failed to load organizations',
        );
      }
      if (!projectResponse.ok && projectResponse.status !== 500) {
        throw new Error(projectPayload.error || 'Failed to load projects');
      }
      setOrganizations(organizationPayload.organizations || []);
      setCurrentOrganization(organizationPayload.currentOrganization || null);
      setCurrentProjectName(
        projectPayload.currentProject?.displayName ||
          organizationPayload.currentProjectName ||
          'Default Project',
      );
      setProjects(projectPayload.projects || []);
    } catch (error: any) {
      message.error(error.message || 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOrganizations();
  }, []);

  const hasOrganizations = organizations.length > 0;
  const currentLabel = currentOrganization?.identifier || 'Create organization';
  const projectLabel = useMemo(
    () => currentProjectName || 'Default Project',
    [currentProjectName],
  );
  const filteredProjects = useMemo(() => {
    const keyword = projectSearch.trim().toLowerCase();
    if (!keyword) {
      return projects;
    }
    return projects.filter((project) =>
      project.displayName.toLowerCase().includes(keyword),
    );
  }, [projectSearch, projects]);

  const createOrganization = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const response = await fetch('/api/v1/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to create organization');
      }
      message.success('Organization created successfully.');
      setVisible(false);
      form.resetFields();
      await loadOrganizations();
      await router.push(Path.OrganizationGeneral);
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      message.error(error.message || 'Failed to create organization');
    } finally {
      setSaving(false);
    }
  };

  const selectOrganization = async (organizationId: number) => {
    try {
      const response = await fetch(
        `/api/v1/organizations/${organizationId}/select`,
        {
          method: 'POST',
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to switch organization');
      }
      message.success('Organization switched successfully.');
      await loadOrganizations();
    } catch (error: any) {
      message.error(error.message || 'Failed to switch organization');
    }
  };

  const selectProject = async (projectId: number) => {
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/select`, {
        method: 'POST',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to switch project');
      }
      message.success('Project switched successfully.');
      await loadOrganizations();
      await router.push(Path.Home);
    } catch (error: any) {
      message.error(error.message || 'Failed to switch project');
    }
  };

  const startNewProjectFlow = async () => {
    setProjectModalVisible(false);
    await router.push({
      pathname: Path.OnboardingConnection,
      query: {
        newProject: '1',
        projectType: selectedProjectType,
      },
    });
  };

  const overlay = (
    <Overlay>
      <OverlayHeader>
        <OverlayLabel>Projects</OverlayLabel>
        <Tooltip title="Create new project">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setProjectModalVisible(true)}
          />
        </Tooltip>
      </OverlayHeader>
      <OverlayBody>
        <SearchBox
          allowClear
          placeholder="Search projects..."
          prefix={<SearchOutlined />}
          value={projectSearch}
          onChange={(event) => setProjectSearch(event.target.value)}
        />
        <Button
          block
          icon={<PlusOutlined />}
          size="large"
          style={{ marginBottom: 12 }}
          onClick={() => setProjectModalVisible(true)}
        >
          New project
        </Button>
        {filteredProjects.map((project) => (
          <MenuRow
            key={project.id}
            type="button"
            $active={project.isCurrent}
            onClick={() => void selectProject(project.id)}
          >
            <div className="d-flex flex-column">
              <div className="gray-8 text-medium">{project.displayName}</div>
              <ProjectTypeTag>
                {project.projectType === WorkspaceProjectType.AGENTIC
                  ? 'Agentic'
                  : 'Classic'}
              </ProjectTypeTag>
            </div>
            {project.isCurrent && <ProjectTypeTag>Current</ProjectTypeTag>}
          </MenuRow>
        ))}
        <SectionLabel>Organizations</SectionLabel>
        {organizations.map((organization) => (
          <div key={organization.id}>
            <MenuRow
              type="button"
              $active={organization.isCurrent}
              onClick={() => void selectOrganization(organization.id)}
            >
              <OrganizationBadge>
                {getBadgeText(organization.name)}
              </OrganizationBadge>
              <div>
                <div className="gray-8 text-medium">{organization.identifier}</div>
                <Typography.Text className="gray-6 text-sm">
                  {organization.name}
                </Typography.Text>
              </div>
            </MenuRow>
          </div>
        ))}
      </OverlayBody>
      {currentOrganization && (
        <OverlayFooter>
          <Button
            type="text"
            block
            icon={<SettingOutlined />}
            onClick={() => void router.push(Path.OrganizationGeneral)}
          >
            Organization settings
          </Button>
        </OverlayFooter>
      )}
    </Overlay>
  );

  if (loading) {
    return <Spin size="small" />;
  }

  return (
    <>
      {hasOrganizations ? (
        <Dropdown overlay={overlay} trigger={['click']} placement="bottomCenter">
          <TriggerButton type="text">
            <Space size={8}>
              <span>{currentLabel}</span>
              <span>/</span>
              <span>{projectLabel}</span>
              <DownOutlined style={{ fontSize: 10 }} />
            </Space>
          </TriggerButton>
        </Dropdown>
      ) : (
        <Button type="primary" ghost size="small" onClick={() => setVisible(true)}>
          <PlusOutlined /> Create organization
        </Button>
      )}

      <Modal
        title="Create organization"
        visible={visible}
        okText="Create"
        confirmLoading={saving}
        onOk={() => void createOrganization()}
        onCancel={() => {
          setVisible(false);
          form.resetFields();
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Organization name"
            rules={[
              { required: true, message: 'Organization name is required' },
              { max: 64, message: 'Organization name must be 64 characters or fewer' },
            ]}
          >
            <Input placeholder="Acme Analytics" />
          </Form.Item>
          <Form.Item
            name="identifier"
            label="Identifier"
            extra="Lowercase letters, numbers, underscores, and hyphens only. Leave blank to generate from the name."
            rules={[
              {
                pattern: /^[A-Za-z0-9_\-\s]*$/,
                message:
                  'Identifier can only contain letters, numbers, spaces, underscores, and hyphens',
              },
            ]}
          >
            <Input placeholder="acme_analytics" />
          </Form.Item>
          <Form.Item
            name="description"
            label="Description"
            rules={[
              {
                max: 255,
                message: 'Description must be 255 characters or fewer',
              },
            ]}
          >
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 5 }}
              placeholder="Optional context about this organization"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Create project"
        visible={projectModalVisible}
        footer={[
          <Button key="cancel" onClick={() => setProjectModalVisible(false)}>
            Cancel
          </Button>,
          <Button key="next" type="primary" onClick={() => void startNewProjectFlow()}>
            Next
          </Button>,
        ]}
        onCancel={() => setProjectModalVisible(false)}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <ProjectCard
            type="button"
            $selected={selectedProjectType === WorkspaceProjectType.AGENTIC}
            onClick={() => setSelectedProjectType(WorkspaceProjectType.AGENTIC)}
          >
            <ProjectOptionRow>
              <div>
                <div className="gray-8 text-medium">
                  Agentic project{' '}
                  <Typography.Text className="text-xs blue-5">
                    RECOMMENDED
                  </Typography.Text>
                </div>
                <Typography.Paragraph className="gray-6 text-sm mb-0 mt-2">
                  Agentic mode, Knowledge, Skills, Memory, and artifacts for
                  charts, dashboards, and reports.
                </Typography.Paragraph>
              </div>
              <Radio checked={selectedProjectType === WorkspaceProjectType.AGENTIC} />
            </ProjectOptionRow>
          </ProjectCard>
          <ProjectCard
            type="button"
            $selected={selectedProjectType === WorkspaceProjectType.CLASSIC}
            onClick={() => setSelectedProjectType(WorkspaceProjectType.CLASSIC)}
          >
            <ProjectOptionRow>
              <div>
                <div className="gray-8 text-medium">Classic project</div>
                <Typography.Paragraph className="gray-6 text-sm mb-0 mt-2">
                  Dashboards, spreadsheets, and the classic BI workflow.
                </Typography.Paragraph>
              </div>
              <Radio checked={selectedProjectType === WorkspaceProjectType.CLASSIC} />
            </ProjectOptionRow>
          </ProjectCard>
        </Space>
      </Modal>
    </>
  );
}
