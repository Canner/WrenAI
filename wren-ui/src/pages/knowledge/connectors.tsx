import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import PageLayout from '@/components/layouts/PageLayout';
import SiderLayout from '@/components/layouts/SiderLayout';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';
import { RUNTIME_SELECTOR_STATE } from '@/apollo/client/graphql/runtimeScope';

const { Paragraph, Text } = Typography;

type ConnectorView = {
  id: string;
  workspaceId: string;
  knowledgeBaseId?: string | null;
  type: string;
  displayName: string;
  config?: Record<string, any> | null;
  hasSecret?: boolean;
  createdBy?: string | null;
};

type RuntimeSelectorStateView = {
  currentWorkspace?: { id: string; name: string } | null;
  currentKnowledgeBase?: { id: string; name: string } | null;
};

type RuntimeSelectorStateData = {
  runtimeSelectorState?: RuntimeSelectorStateView | null;
};

type ConnectorFormValues = {
  type: string;
  displayName: string;
  configText?: string;
  secretText?: string;
  clearSecret?: boolean;
};

type ConnectorSubmitPayload = {
  type: string;
  displayName: string;
  config: Record<string, any> | null;
  secret?: Record<string, any> | null;
};

export const buildConnectorsCollectionUrl = () =>
  buildRuntimeScopeUrl('/api/v1/connectors');

export const buildConnectorItemUrl = (id: string) =>
  buildRuntimeScopeUrl(`/api/v1/connectors/${id}`);

export const CONNECTOR_TYPE_OPTIONS = [
  { label: 'REST JSON', value: 'rest_json' },
  { label: 'Database', value: 'database' },
  { label: 'Python Tool', value: 'python_tool' },
];

export const CONNECTOR_SECRET_EDIT_HINT =
  'Leave secret JSON blank to keep the existing secret unchanged.';
export const CONNECTOR_CLEAR_SECRET_LABEL = 'Clear existing secret';

const parseOptionalJsonObject = (value?: string) => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = JSON.parse(value);
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    throw new Error('JSON payload must be an object');
  }

  return parsed;
};

const stringifyJson = (value?: Record<string, any> | null) =>
  value ? JSON.stringify(value, null, 2) : '';

export const buildConnectorSubmitPayload = ({
  values,
  editing,
}: {
  values: ConnectorFormValues;
  editing: boolean;
}): ConnectorSubmitPayload => {
  const payload: ConnectorSubmitPayload = {
    type: values.type,
    displayName: values.displayName.trim(),
    config: parseOptionalJsonObject(values.configText),
  };

  if (editing && values.clearSecret) {
    payload.secret = null;
    return payload;
  }

  const secretText = values.secretText?.trim();
  if (!editing || secretText) {
    payload.secret = parseOptionalJsonObject(values.secretText);
  }

  return payload;
};

export default function ManageConnectors() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const [form] = Form.useForm<ConnectorFormValues>();
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<ConnectorView | null>(null);
  const [clearSecretChecked, setClearSecretChecked] = useState(false);

  const { data } = useQuery<RuntimeSelectorStateData>(RUNTIME_SELECTOR_STATE, {
    fetchPolicy: 'cache-and-network',
    skip: !runtimeScopePage.hasRuntimeScope,
  });

  const runtimeSelectorState = data?.runtimeSelectorState;
  const connectorTypeOptions = useMemo(() => CONNECTOR_TYPE_OPTIONS, []);

  const loadConnectors = async () => {
    if (!runtimeScopePage.hasRuntimeScope) {
      setConnectors([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(buildConnectorsCollectionUrl());
      if (!response.ok) {
        throw new Error(`Failed to load connectors: ${response.status}`);
      }

      const payload = await response.json();
      setConnectors(Array.isArray(payload) ? payload : []);
    } catch (error: any) {
      message.error(error.message || 'Failed to load connectors.');
      setConnectors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConnectors();
  }, [runtimeScopePage.hasRuntimeScope, runtimeSelectorState?.currentKnowledgeBase?.id]);

  const openCreateModal = () => {
    setEditingConnector(null);
    setClearSecretChecked(false);
    form.resetFields();
    form.setFieldsValue({ type: 'rest_json' });
    setModalOpen(true);
  };

  const openEditModal = (connector: ConnectorView) => {
    setEditingConnector(connector);
    setClearSecretChecked(false);
    form.setFieldsValue({
      type: connector.type,
      displayName: connector.displayName,
      configText: stringifyJson(connector.config),
      secretText: '',
    });
    setModalOpen(true);
  };

  const submitConnector = async () => {
    try {
      const values = await form.validateFields();
      const payload = buildConnectorSubmitPayload({
        values: {
          ...values,
          clearSecret: clearSecretChecked,
        },
        editing: Boolean(editingConnector),
      });

      setSubmitting(true);
      const response = await fetch(
        editingConnector
          ? buildConnectorItemUrl(editingConnector.id)
          : buildConnectorsCollectionUrl(),
        {
          method: editingConnector ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to save connector.');
      }

      message.success(
        editingConnector
          ? 'Successfully updated connector.'
          : 'Successfully created connector.',
      );
      setModalOpen(false);
      setEditingConnector(null);
      setClearSecretChecked(false);
      form.resetFields();
      await loadConnectors();
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      message.error(error.message || 'Failed to save connector.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteConnector = async (connectorId: string) => {
    try {
      const response = await fetch(buildConnectorItemUrl(connectorId), {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Failed to delete connector.');
      }

      message.success('Successfully deleted connector.');
      await loadConnectors();
    } catch (error: any) {
      message.error(error.message || 'Failed to delete connector.');
    }
  };

  if (runtimeScopePage.guarding) {
    return <SiderLayout loading>{null}</SiderLayout>;
  }

  return (
    <SiderLayout loading={loading}>
      <PageLayout
        title={
          <>
            <ApiOutlined className="mr-2 gray-8" />
            Manage connectors
          </>
        }
        description={
          <>
            Connectors define external APIs, databases, or tool endpoints that
            skills can bind to inside the active knowledge base.
          </>
        }
        titleExtra={
          <Button type="primary" onClick={openCreateModal}>
            Add connector
          </Button>
        }
      >
        <Card>
          <Paragraph className="gray-7">
            Workspace:{' '}
            <Text strong>
              {runtimeSelectorState?.currentWorkspace?.name || 'Unknown'}
            </Text>
          </Paragraph>
          <Paragraph className="gray-7">
            Knowledge base:{' '}
            <Text strong>
              {runtimeSelectorState?.currentKnowledgeBase?.name || 'Unknown'}
            </Text>
          </Paragraph>
          <Table
            className="ant-table-has-header"
            rowKey="id"
            dataSource={connectors}
            pagination={{ hideOnSinglePage: true, pageSize: 10, size: 'small' }}
            columns={[
              {
                title: 'Connector',
                dataIndex: 'displayName',
                render: (value: string, record: ConnectorView) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{value}</Text>
                    <Text type="secondary">{record.type}</Text>
                  </Space>
                ),
              },
              {
                title: 'Config',
                dataIndex: 'config',
                render: (value: Record<string, any> | null | undefined) =>
                  value ? (
                    <Paragraph ellipsis={{ rows: 3 }} className="mb-0">
                      {JSON.stringify(value)}
                    </Paragraph>
                  ) : (
                    <Text type="secondary">—</Text>
                  ),
              },
              {
                title: 'Secret',
                dataIndex: 'hasSecret',
                width: 120,
                render: (hasSecret: boolean | undefined) =>
                  hasSecret ? <Tag color="green">Configured</Tag> : <Tag>No secret</Tag>,
              },
              {
                title: 'Actions',
                key: 'actions',
                width: 160,
                render: (_: any, record: ConnectorView) => (
                  <Space>
                    <Button size="small" onClick={() => openEditModal(record)}>
                      Edit
                    </Button>
                    <Popconfirm
                      title="Delete this connector?"
                      onConfirm={() => deleteConnector(record.id)}
                    >
                      <Button size="small" danger>
                        Delete
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </Card>

        <Modal
          title={editingConnector ? 'Edit connector' : 'Add connector'}
          visible={modalOpen}
          onCancel={() => {
            setModalOpen(false);
            setEditingConnector(null);
            setClearSecretChecked(false);
          }}
          onOk={submitConnector}
          confirmLoading={submitting}
          destroyOnClose
        >
          <Form layout="vertical" form={form}>
            <Form.Item
              name="type"
              label="Connector type"
              rules={[{ required: true, message: 'Choose a connector type' }]}
            >
              <Select options={connectorTypeOptions} />
            </Form.Item>
            <Form.Item
              name="displayName"
              label="Display name"
              rules={[{ required: true, message: 'Connector display name is required' }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="configText" label="Config JSON">
              <Input.TextArea
                rows={8}
                placeholder='{"baseUrl": "https://api.example.com", "timeoutMs": 3000}'
              />
            </Form.Item>
            <Form.Item name="secretText" label="Secret JSON">
              <Input.TextArea
                rows={6}
                placeholder='{"apiKey": "secret-token"}'
                disabled={clearSecretChecked}
              />
            </Form.Item>
            {editingConnector?.hasSecret && (
              <Form.Item label={CONNECTOR_CLEAR_SECRET_LABEL}>
                <Switch
                  checked={clearSecretChecked}
                  onChange={setClearSecretChecked}
                />
              </Form.Item>
            )}
            {editingConnector && (
              <Paragraph className="gray-7 mb-0">
                {CONNECTOR_SECRET_EDIT_HINT}
              </Paragraph>
            )}
          </Form>
        </Modal>
      </PageLayout>
    </SiderLayout>
  );
}
