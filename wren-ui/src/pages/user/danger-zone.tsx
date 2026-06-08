import { Button, Modal, Typography, message } from 'antd';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import OrganizationSettingsLayout from '@/components/organization/SettingsLayout';
import { Path } from '@/utils/enum';

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

export default function UserDangerZonePage() {
  const router = useRouter();

  const deleteAccount = async () => {
    try {
      const response = await fetch('/api/v1/users/current', {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete account');
      }
      message.success('Account deleted successfully.');
      await router.push(Path.OrganizationGeneral);
    } catch (error: any) {
      message.error(error.message || 'Failed to delete account');
    }
  };

  return (
    <OrganizationSettingsLayout
      section="user-danger-zone"
      title="Danger zone"
    >
      <IntroText>In the Danger Zone section, you can delete your account.</IntroText>

      <DangerPanel>
        <DangerRow>
          <DangerCopy>
            <DangerTitle>Delete account</DangerTitle>
            <DangerDescription>
              Please be aware that deleting the account will permanently delete
              all data and associations, it cannot be undone.
            </DangerDescription>
          </DangerCopy>
          <Button
            danger
            onClick={() =>
              Modal.confirm({
                title: 'Delete account?',
                content:
                  'This permanently deletes your account and removes your organization associations. This action cannot be undone.',
                okText: 'Delete account',
                okButtonProps: { danger: true },
                onOk: deleteAccount,
              })
            }
          >
            Delete account
          </Button>
        </DangerRow>
      </DangerPanel>
    </OrganizationSettingsLayout>
  );
}
