import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Typography, message } from 'antd';
import styled from 'styled-components';
import OrganizationSettingsLayout from '@/components/organization/SettingsLayout';
import { LoadingWrapper } from '@/components/PageLoading';

interface CurrentUserProfile {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  error?: string;
}

const IntroText = styled(Typography.Text)`
  display: block;
  margin-top: 12px;
  margin-bottom: 24px;
  max-width: 920px;
  color: var(--gray-7);
`;

const SettingsCard = styled.div`
  margin-top: 16px;
  border: 1px solid var(--gray-4);
  border-radius: 4px;
  padding: 24px 28px 28px;
  background: white;
  max-width: 1060px;
`;

const InlineRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 760px;

  & + & {
    margin-top: 24px;
  }
`;

const LabelCell = styled.div`
  width: 220px;
  text-align: right;
  color: var(--gray-9);
  flex-shrink: 0;
`;

const FieldCell = styled.div`
  flex: 1;
`;

const Actions = styled.div`
  margin-top: 24px;
  margin-left: 228px;
  display: flex;
  gap: 8px;
`;

const PasswordHint = styled(Typography.Text)`
  display: block;
  margin-top: 8px;
  color: var(--gray-7);
`;

export default function UserProfilePage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<CurrentUserProfile | null>(null);
  const [initialName, setInitialName] = useState('');

  const loadUser = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/users/current');
      const payload = (await response.json()) as CurrentUserProfile;
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load profile');
      }
      setUser(payload);
      setInitialName(payload.name || '');
      form.setFieldsValue({
        name: payload.name || '',
        email: payload.email || '',
      });
    } catch (error: any) {
      message.error(error.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUser();
  }, []);

  const currentName = Form.useWatch('name', form);
  const hasChanges = useMemo(
    () => (currentName || '').trim() !== initialName,
    [currentName, initialName],
  );

  const resetChanges = () => {
    form.setFieldsValue({ name: initialName, email: user?.email || '' });
  };

  const saveProfile = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const response = await fetch('/api/v1/users/current', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: values.name }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update profile');
      }

      setUser(payload);
      setInitialName(payload.name || '');
      form.setFieldsValue({
        name: payload.name || '',
        email: payload.email || '',
      });
      message.success('Profile updated successfully.');
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const requestPasswordChange = () => {
    message.info(
      'Password change email delivery will be handled by the configured identity provider.',
    );
  };

  return (
    <OrganizationSettingsLayout section="user-profile" title="User Account">
      <LoadingWrapper loading={loading}>
        <IntroText>
          Use this page to verify access, update your profile, and understand
          how account and project roles affect what you can do in Wren AI.
        </IntroText>

        <Typography.Title level={4} className="mt-4 mb-0 gray-8">
          Profile information
        </Typography.Title>
        <Typography.Title level={5} className="mt-4 mb-0 gray-8">
          Details
        </Typography.Title>
        <SettingsCard>
          <Form form={form} layout="vertical">
            <InlineRow>
              <LabelCell>Name :</LabelCell>
              <FieldCell>
                <Form.Item
                  name="name"
                  className="mb-0"
                  rules={[
                    {
                      required: true,
                      whitespace: true,
                      message: 'Name is required',
                    },
                    {
                      max: 160,
                      message: 'Name must be 160 characters or fewer',
                    },
                  ]}
                >
                  <Input disabled={!user} />
                </Form.Item>
              </FieldCell>
            </InlineRow>
            <InlineRow>
              <LabelCell>Email :</LabelCell>
              <FieldCell>
                <Form.Item name="email" className="mb-0">
                  <Input disabled />
                </Form.Item>
              </FieldCell>
            </InlineRow>
          </Form>
          <Actions>
            <Button onClick={resetChanges} disabled={!hasChanges || saving}>
              Discard changes
            </Button>
            <Button
              type="primary"
              onClick={() => void saveProfile()}
              loading={saving}
              disabled={!user || !hasChanges}
            >
              Save
            </Button>
          </Actions>
        </SettingsCard>

        <Typography.Title level={4} className="mt-5 mb-0 gray-8">
          Account Verification
        </Typography.Title>
        <IntroText>
          To ensure security, account verification is handled by the configured
          identity provider or invitation flow for your organization.
        </IntroText>

        <Typography.Title level={4} className="mt-5 mb-0 gray-8">
          Change password
        </Typography.Title>
        <SettingsCard>
          <InlineRow>
            <LabelCell>Password :</LabelCell>
            <FieldCell>
              <Button onClick={requestPasswordChange}>Change password</Button>
              <PasswordHint>
                You will receive a confirmation link via email when password
                reset delivery is configured.
              </PasswordHint>
            </FieldCell>
          </InlineRow>
        </SettingsCard>
      </LoadingWrapper>
    </OrganizationSettingsLayout>
  );
}
