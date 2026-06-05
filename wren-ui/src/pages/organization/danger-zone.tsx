import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Typography, message } from 'antd';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import OrganizationSettingsLayout from '@/components/organization/SettingsLayout';
import { LoadingWrapper } from '@/components/PageLoading';
import { Path } from '@/utils/enum';

type OrganizationRole = 'Admin' | 'Member';

interface OrganizationMember {
  id: number;
  userId: number;
  name: string;
  email: string;
  organizationRole: OrganizationRole;
}

interface OrganizationMembersResponse {
  members: OrganizationMember[];
  currentUserId: number | null;
  error?: string;
}

const IntroText = styled(Typography.Text)`
  display: block;
  margin-top: 12px;
  color: var(--gray-7);
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

const LastAdminNotice = styled(Typography.Text)`
  display: block;
  margin-top: 8px;
  color: var(--gray-7);
`;

export default function OrganizationDangerZonePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/organizations/members');
      const payload = (await response.json()) as OrganizationMembersResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load organization members');
      }
      setMembers(payload.members || []);
      setCurrentUserId(payload.currentUserId ?? null);
    } catch (error: any) {
      message.error(error.message || 'Failed to load organization members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMembers();
  }, []);

  const currentMember = useMemo(
    () => members.find((member) => member.userId === currentUserId) || null,
    [currentUserId, members],
  );
  const isCurrentAdmin = currentMember?.organizationRole === 'Admin';
  const adminCount = useMemo(
    () =>
      members.filter((member) => member.organizationRole === 'Admin').length,
    [members],
  );
  const isLastAdmin = Boolean(isCurrentAdmin && adminCount <= 1);
  const canDeleteOrganization = Boolean(isCurrentAdmin);

  const leaveOrganization = async () => {
    setLeaving(true);
    try {
      const response = await fetch('/api/v1/organizations/members/current', {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to leave organization');
      }
      message.success('Left organization successfully.');
      await router.push(Path.OrganizationGeneral);
    } catch (error: any) {
      message.error(error.message || 'Failed to leave organization');
    } finally {
      setLeaving(false);
    }
  };

  const deleteOrganization = async () => {
    setDeleting(true);
    try {
      const response = await fetch('/api/v1/organizations/current', {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete organization');
      }
      message.success('Organization deleted successfully.');
      await router.push(Path.OrganizationGeneral);
    } catch (error: any) {
      message.error(error.message || 'Failed to delete organization');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <OrganizationSettingsLayout section="danger-zone" title="Danger zone">
      <LoadingWrapper loading={loading}>
        <IntroText>
          In Danger Zone, you can leave or delete this organization according
          to your assigned role.
        </IntroText>

        <DangerPanel>
          <DangerRow>
            <DangerCopy>
              <DangerTitle>Leave organization</DangerTitle>
              <DangerDescription>
                Organization Members can leave the organization at any time. The
                organization and its projects will no longer be accessible.
              </DangerDescription>
              {isLastAdmin && (
                <LastAdminNotice>
                  If you are the last Organization admin, you cannot leave the
                  organization. You will need to delete the organization to
                  remove yourself from it.
                </LastAdminNotice>
              )}
            </DangerCopy>
            <Button
              danger
              type="primary"
              loading={leaving}
              disabled={!currentMember || isLastAdmin || deleting}
              onClick={() =>
                Modal.confirm({
                  title: 'Leave organization?',
                  content:
                    'This organization and its projects will no longer be accessible to you.',
                  okText: 'Leave organization',
                  okButtonProps: { danger: true },
                  onOk: leaveOrganization,
                })
              }
            >
              Leave organization
            </Button>
          </DangerRow>

          <DangerRow>
            <DangerCopy>
              <DangerTitle>Delete organization</DangerTitle>
              <DangerDescription>
                Only organization admins can delete the organization. This
                action can not be reversed; be careful when performing this
                action.
              </DangerDescription>
              <LastAdminNotice>
                Once the organization is deleted, its projects will no longer be
                available to all the organization's users.
              </LastAdminNotice>
            </DangerCopy>
            <Button
              danger
              type={canDeleteOrganization ? 'primary' : 'default'}
              loading={deleting}
              disabled={!canDeleteOrganization || leaving}
              onClick={() =>
                Modal.confirm({
                  title: 'Delete organization?',
                  content:
                    "This permanently deletes the organization and makes its projects unavailable to all the organization's users.",
                  okText: 'Delete organization',
                  okButtonProps: { danger: true },
                  onOk: deleteOrganization,
                })
              }
            >
              Delete organization
            </Button>
          </DangerRow>
        </DangerPanel>
      </LoadingWrapper>
    </OrganizationSettingsLayout>
  );
}
