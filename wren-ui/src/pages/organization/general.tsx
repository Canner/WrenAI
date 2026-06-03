import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Typography, message } from 'antd';
import styled from 'styled-components';
import OrganizationSettingsLayout from '@/components/organization/SettingsLayout';
import { LoadingWrapper } from '@/components/PageLoading';

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
  error?: string;
}

const SettingsCard = styled.div`
  margin-top: 16px;
  border: 1px solid var(--gray-4);
  border-radius: 4px;
  padding: 20px 28px 28px;
  background: white;
`;

const InlineRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 860px;
`;

const LabelCell = styled.div`
  width: 160px;
  text-align: right;
  color: var(--gray-8);
  flex-shrink: 0;
`;

const FieldCell = styled.div`
  flex: 1;
`;

const Actions = styled.div`
  margin-left: 176px;
  display: flex;
  gap: 8px;
`;

export default function OrganizationGeneralPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasOrganization, setHasOrganization] = useState(false);
  const [initialName, setInitialName] = useState('');

  const loadOrganization = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/organizations/current');
      const payload = (await response.json()) as OrganizationResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load organization');
      }

      const organization = payload.currentOrganization;
      setHasOrganization(Boolean(organization));
      const organizationName = organization?.name || '';
      setInitialName(organizationName);
      form.setFieldsValue({ name: organizationName });
    } catch (error: any) {
      message.error(error.message || 'Failed to load organization');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOrganization();
  }, []);

  const currentName = Form.useWatch('name', form);
  const hasChanges = useMemo(
    () => (currentName || '').trim() !== initialName,
    [currentName, initialName],
  );

  const resetChanges = () => {
    form.setFieldsValue({ name: initialName });
  };

  const saveChanges = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const response = await fetch('/api/v1/organizations/current', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update organization');
      }

      const updatedName = payload.name || values.name;
      setInitialName(updatedName);
      form.setFieldsValue({ name: updatedName });
      message.success('Organization updated successfully.');
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error.message || 'Failed to update organization');
    } finally {
      setSaving(false);
    }
  };

  return (
    <OrganizationSettingsLayout section="general" title="General">
      <LoadingWrapper loading={loading}>
        <div>
          <Typography.Title level={4} className="mt-4 mb-0 gray-8">
            Organization name
          </Typography.Title>

          <SettingsCard>
            {!hasOrganization && (
              <Typography.Text className="gray-7 d-block mb-3">
                Create an organization from the header before editing
                organization settings.
              </Typography.Text>
            )}
            <InlineRow>
              <LabelCell>Organization name</LabelCell>
              <FieldCell>
                <Form form={form} layout="vertical">
                  <Form.Item
                    name="name"
                    className="mb-0"
                    rules={[
                      {
                        required: true,
                        whitespace: true,
                        message: 'Organization name is required',
                      },
                      {
                        max: 64,
                        message:
                          'Organization name must be 64 characters or fewer',
                      },
                    ]}
                  >
                    <Input
                      placeholder="Organization name"
                      disabled={!hasOrganization}
                    />
                  </Form.Item>
                </Form>
              </FieldCell>
            </InlineRow>
            <Actions>
              <Button
                onClick={resetChanges}
                disabled={!hasOrganization || !hasChanges || saving}
              >
                Discard changes
              </Button>
              <Button
                type="primary"
                onClick={() => void saveChanges()}
                loading={saving}
                disabled={!hasOrganization || !hasChanges}
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
