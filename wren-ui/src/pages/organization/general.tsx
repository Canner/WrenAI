import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Form,
  Input,
  Layout,
  Typography,
  message,
} from 'antd';
import styled from 'styled-components';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import { LoadingWrapper } from '@/components/PageLoading';
import { Path } from '@/utils/enum';

const { Sider, Content } = Layout;

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

const linkStyle = { color: 'inherit', transition: 'none' };

const StyledSider = styled(Sider)`
  height: calc(100vh - 48px);
  background: var(--gray-2);
  border-right: 1px solid var(--gray-4);
  overflow-y: auto;
`;

const StyledContent = styled(Content)`
  height: calc(100vh - 48px);
  overflow-y: auto;
  background: white;
`;

const SidebarSection = styled.div`
  padding: 14px 16px 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--gray-7);
`;

const SidebarItem = styled.div<{ $active?: boolean; $disabled?: boolean }>`
  padding: 6px 20px;
  color: ${(props) =>
    props.$active
      ? 'var(--gray-10)'
      : props.$disabled
        ? 'var(--gray-7)'
        : 'var(--gray-8)'};
  background: ${(props) => (props.$active ? 'var(--gray-4)' : 'transparent')};
  font-weight: ${(props) => (props.$active ? 600 : 400)};
`;

const PageBody = styled.div`
  padding: 24px 48px;
`;

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

const PlaceholderItem = ({ children }: { children: React.ReactNode }) => (
  <SidebarItem $disabled>{children}</SidebarItem>
);

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
    <SimpleLayout loading={false}>
      <Layout>
        <StyledSider width={252}>
          <SidebarSection>Project</SidebarSection>
          <PlaceholderItem>General</PlaceholderItem>
          <PlaceholderItem>Access control</PlaceholderItem>
          <PlaceholderItem>Data source</PlaceholderItem>
          <PlaceholderItem>Danger zone</PlaceholderItem>

          <SidebarSection>Organization</SidebarSection>
          <SidebarItem $active>
            <Link style={linkStyle} href={Path.OrganizationGeneral}>
              General
            </Link>
          </SidebarItem>
          <PlaceholderItem>Members</PlaceholderItem>
          <PlaceholderItem>Billing</PlaceholderItem>
          <PlaceholderItem>Danger zone</PlaceholderItem>

          <SidebarSection>User</SidebarSection>
          <PlaceholderItem>Profile</PlaceholderItem>
          <PlaceholderItem>Danger zone</PlaceholderItem>
        </StyledSider>
        <StyledContent>
          <LoadingWrapper loading={loading}>
            <PageBody>
              <Typography.Title level={3} className="mb-0 gray-8">
                General
              </Typography.Title>
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
            </PageBody>
          </LoadingWrapper>
        </StyledContent>
      </Layout>
    </SimpleLayout>
  );
}
