import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Select, Typography, message } from 'antd';
import CopyOutlined from '@ant-design/icons/CopyOutlined';
import styled from 'styled-components';
import OrganizationSettingsLayout from '@/components/organization/SettingsLayout';
import { LoadingWrapper } from '@/components/PageLoading';
import {
  useGetSettingsQuery,
  useUpdateCurrentProjectMutation,
} from '@/apollo/client/graphql/settings.generated';
import {
  ProjectLanguage,
  WorkspaceProjectType,
} from '@/apollo/client/graphql/__types__';
import { getLanguageText } from '@/utils/language';

interface CurrentProjectRecord {
  id: number;
  displayName: string;
  projectType: WorkspaceProjectType;
  isCurrent: boolean;
  hasDataSource: boolean;
  type?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface CurrentProjectResponse {
  currentProject: CurrentProjectRecord | null;
  projects: CurrentProjectRecord[];
  error?: string;
}

const SettingsCard = styled.div`
  margin-top: 16px;
  border: 1px solid var(--gray-4);
  border-radius: 4px;
  padding: 20px 28px 28px;
  background: white;
`;

const DetailsTitle = styled(Typography.Title)`
  && {
    margin-top: 20px;
    margin-bottom: 0;
    color: var(--gray-8);
  }
`;

const InlineRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
  max-width: 860px;
  margin-bottom: 20px;
`;

const LabelCell = styled.div`
  width: 160px;
  text-align: right;
  color: var(--gray-8);
  flex-shrink: 0;
  padding-top: 8px;
`;

const FieldCell = styled.div`
  flex: 1;
`;

const Actions = styled.div`
  margin-left: 176px;
  display: flex;
  gap: 8px;
`;

const HelperText = styled(Typography.Text)`
  display: block;
  margin-top: 6px;
  color: var(--gray-6);
`;

const languageOptions = Object.keys(ProjectLanguage).map((key) => ({
  label: getLanguageText(key as ProjectLanguage),
  value: key,
}));

export default function ProjectGeneralPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<CurrentProjectRecord | null>(null);
  const { data: settingsData } = useGetSettingsQuery();
  const [initialValues, setInitialValues] = useState({
    displayName: '',
    language: ProjectLanguage.EN,
  });

  const [updateCurrentProject, { loading: saving }] =
    useUpdateCurrentProjectMutation({
      onError: (error) =>
        message.error(error.message || 'Failed to update project'),
      onCompleted: () => {
        message.success('Project updated successfully.');
      },
    });

  const loadProject = async () => {
    setLoading(true);
    try {
      const currentProjectResponse = await fetch('/api/v1/projects/current');
      const currentProjectPayload =
        (await currentProjectResponse.json()) as CurrentProjectResponse;
      if (!currentProjectResponse.ok) {
        throw new Error(
          currentProjectPayload.error || 'Failed to load current project',
        );
      }

      const currentProject = currentProjectPayload.currentProject;
      if (!currentProject) {
        throw new Error('No current project found');
      }

      const values = {
        displayName: currentProject.displayName || '',
        language: settingsData?.settings?.language || ProjectLanguage.EN,
      };

      setProject(currentProject);
      setInitialValues(values);
      form.setFieldsValue(values);
    } catch (error: any) {
      message.error(error.message || 'Failed to load project settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProject();
  }, [settingsData?.settings?.language]);

  const currentDisplayName = Form.useWatch('displayName', form);
  const currentLanguage = Form.useWatch('language', form);
  const hasChanges = useMemo(
    () =>
      (currentDisplayName || '').trim() !== initialValues.displayName ||
      currentLanguage !== initialValues.language,
    [currentDisplayName, currentLanguage, initialValues],
  );

  const resetChanges = () => {
    form.setFieldsValue(initialValues);
  };

  const copyProjectId = async () => {
    if (!project?.id) return;
    try {
      await navigator.clipboard.writeText(String(project.id));
      message.success('Project ID copied.');
    } catch {
      message.error('Failed to copy project ID');
    }
  };

  const saveChanges = async () => {
    try {
      const values = await form.validateFields();
      await updateCurrentProject({
        variables: {
          data: {
            displayName: values.displayName.trim(),
            language: values.language,
          },
        },
      });
      const updatedValues = {
        displayName: values.displayName.trim(),
        language: values.language,
      };
      setInitialValues(updatedValues);
      setProject((current) =>
        current
          ? {
              ...current,
              displayName: updatedValues.displayName,
            }
          : current,
      );
      form.setFieldsValue(updatedValues);
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error.message || 'Failed to update project');
    }
  };

  return (
    <OrganizationSettingsLayout section="project-general" title="General">
      <LoadingWrapper loading={loading}>
        <div>
          <DetailsTitle level={4}>Details</DetailsTitle>
          <SettingsCard>
            <Form form={form} layout="vertical">
              <InlineRow>
                <LabelCell>Project ID:</LabelCell>
                <FieldCell>
                  <Input
                    value={project?.id ? String(project.id) : ''}
                    readOnly
                    addonAfter={
                      <Button
                        type="text"
                        icon={<CopyOutlined />}
                        onClick={() => void copyProjectId()}
                      />
                    }
                  />
                </FieldCell>
              </InlineRow>

              <InlineRow>
                <LabelCell>Project name:</LabelCell>
                <FieldCell>
                  <Form.Item
                    name="displayName"
                    className="mb-0"
                    rules={[
                      {
                        required: true,
                        whitespace: true,
                        message: 'Project name is required',
                      },
                      {
                        max: 64,
                        message: 'Project name must be 64 characters or fewer',
                      },
                    ]}
                  >
                    <Input placeholder="Project name" />
                  </Form.Item>
                </FieldCell>
              </InlineRow>

              <InlineRow>
                <LabelCell>Project language:</LabelCell>
                <FieldCell>
                  <Form.Item name="language" className="mb-0">
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={languageOptions}
                    />
                  </Form.Item>
                  <HelperText>
                    This setting will affect the language in which the AI
                    responds to you.
                  </HelperText>
                </FieldCell>
              </InlineRow>
            </Form>

            <Actions>
              <Button onClick={resetChanges} disabled={!hasChanges || saving}>
                Discard changes
              </Button>
              <Button
                type="primary"
                onClick={() => void saveChanges()}
                loading={saving}
                disabled={!hasChanges}
              >
                Save
              </Button>
            </Actions>
          </SettingsCard>
        </div>
      </LoadingWrapper>
    </OrganizationSettingsLayout>
  );
}
