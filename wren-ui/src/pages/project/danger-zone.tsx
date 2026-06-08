import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Typography, message } from 'antd';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import OrganizationSettingsLayout from '@/components/organization/SettingsLayout';
import { LoadingWrapper } from '@/components/PageLoading';
import { Path } from '@/utils/enum';
import { useResetCurrentProjectMutation } from '@/apollo/client/graphql/settings.generated';

type OrganizationRole = 'Admin' | 'Member';

interface ProjectAccessMember {
  userId: number;
  organizationRole: OrganizationRole;
  isCurrentUser: boolean;
}

interface ProjectAccessResponse {
  members: ProjectAccessMember[];
  currentUserId: number | null;
  error?: string;
}

const IntroText = styled(Typography.Text)`
  display: block;
  margin-top: 12px;
  color: var(--gray-7);
`;

const WarningText = styled(Typography.Text)`
  display: block;
  margin-top: 12px;
  color: var(--red-6);
`;

const DangerPanel = styled.div`
  margin-top: 24px;
  border: 1px solid var(--red-5);
  border-radius: 4px;
  background: white;
`;

const DangerRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 24px;

  & + & {
    border-top: 1px solid var(--gray-4);
  }
`;

const DangerCopy = styled.div`
  min-width: 0;
`;

const DangerTitle = styled.div`
  color: var(--gray-8);
  font-weight: 600;
  margin-bottom: 6px;
`;

const DangerDescription = styled(Typography.Text)`
  color: var(--gray-6);
`;

const readJsonResponse = async <T,>(response: Response): Promise<T> => {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
};

export default function ProjectDangerZonePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<ProjectAccessResponse | null>(null);
  const [resetCurrentProject, { loading: resetting, client }] =
    useResetCurrentProjectMutation({
      onError: (error) =>
        message.error(error.message || 'Failed to reset project'),
    });

  const loadProjectAccess = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/projects/access/current', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      const payload = await readJsonResponse<ProjectAccessResponse>(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load project access');
      }
      setAccess(payload);
    } catch (error: any) {
      message.error(error.message || 'Failed to load project access');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjectAccess();
  }, []);

  const currentMember = useMemo(
    () =>
      access?.members.find(
        (member) =>
          member.isCurrentUser || member.userId === access.currentUserId,
      ) || null,
    [access],
  );
  const canDeleteProject = currentMember?.organizationRole === 'Admin';

  const resetProject = async () => {
    await resetCurrentProject();
    await client.clearStore();
    message.success('Project reset successfully.');
    await router.push(Path.OnboardingConnection);
  };

  const deleteProject = async () => {
    await resetCurrentProject();
    await client.clearStore();
    message.success('Project deleted successfully.');
    await router.push(Path.OrganizationGeneral);
  };

  return (
    <OrganizationSettingsLayout
      section="project-danger-zone"
      title="Danger zone"
    >
      <LoadingWrapper loading={loading}>
        <IntroText>Use Danger Zone for destructive project actions.</IntroText>
        <WarningText>Actions in this section cannot be undone.</WarningText>

        <DangerPanel>
          <DangerRow>
            <DangerCopy>
              <DangerTitle>Reset project</DangerTitle>
              <DangerDescription>
                Resetting a project removes its current settings and records,
                including data connection information, Modeling page
                information, and Home page threads.
              </DangerDescription>
            </DangerCopy>
            <Button
              danger
              loading={resetting}
              onClick={() =>
                Modal.confirm({
                  title: 'Reset project?',
                  content:
                    'This removes current project settings and records, including data connection information, Modeling page information, and Home page threads.',
                  okText: 'Reset project',
                  okButtonProps: { danger: true },
                  onOk: resetProject,
                })
              }
            >
              Reset project
            </Button>
          </DangerRow>

          <DangerRow>
            <DangerCopy>
              <DangerTitle>Delete project</DangerTitle>
              <DangerDescription>
                Only organization admins can delete a project. Deleting a
                project permanently removes access to its ask records for all
                owners and members.
              </DangerDescription>
            </DangerCopy>
            <Button
              danger
              loading={resetting}
              disabled={!canDeleteProject}
              onClick={() =>
                Modal.confirm({
                  title: 'Delete project?',
                  content:
                    'This permanently removes this project and access to its ask records for all owners and members.',
                  okText: 'Delete project',
                  okButtonProps: { danger: true },
                  onOk: deleteProject,
                })
              }
            >
              Delete project
            </Button>
          </DangerRow>
        </DangerPanel>
      </LoadingWrapper>
    </OrganizationSettingsLayout>
  );
}
