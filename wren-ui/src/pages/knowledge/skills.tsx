import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery } from '@apollo/client';
import CodeOutlined from '@ant-design/icons/CodeOutlined';
import PageLayout from '@/components/layouts/PageLayout';
import SiderLayout from '@/components/layouts/SiderLayout';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  CREATE_SKILL_BINDING,
  CREATE_SKILL_DEFINITION,
  DELETE_SKILL_BINDING,
  DELETE_SKILL_DEFINITION,
  SKILL_CONTROL_PLANE,
  UPDATE_SKILL_BINDING,
  UPDATE_SKILL_DEFINITION,
} from '@/apollo/client/graphql/skills';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';
import { Path } from '@/utils/enum';

const { Text, Paragraph } = Typography;

type SkillDefinitionView = {
  id: string;
  workspaceId: string;
  name: string;
  runtimeKind: string;
  sourceType: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifest?: Record<string, any> | null;
  createdBy?: string | null;
};

type SkillBindingView = {
  id: string;
  knowledgeBaseId: string;
  kbSnapshotId?: string | null;
  skillDefinitionId: string;
  connectorId?: string | null;
  bindingConfig?: Record<string, any> | null;
  enabled: boolean;
  createdBy?: string | null;
};

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

export const buildSkillConnectorOptions = (connectors: ConnectorView[]) => [
  { label: 'No connector', value: '' },
  ...connectors.map((connector) => ({
    label: `${connector.displayName} (${connector.type})`,
    value: connector.id,
  })),
];

export const buildSkillConnectorsApiUrl = () =>
  buildRuntimeScopeUrl('/api/v1/connectors');

type RuntimeSelectorStateView = {
  currentWorkspace?: { id: string; name: string } | null;
  currentKnowledgeBase?: { id: string; name: string } | null;
  currentKbSnapshot?: { id: string; displayName: string } | null;
  kbSnapshots: Array<{ id: string; displayName: string }>;
};

type SkillControlPlaneData = {
  runtimeSelectorState?: RuntimeSelectorStateView | null;
  skillDefinitions: SkillDefinitionView[];
  skillBindings: SkillBindingView[];
};

type SkillDefinitionFormValues = {
  name: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string;
  entrypoint?: string;
  manifestText?: string;
};

type SkillBindingFormValues = {
  skillDefinitionId: string;
  kbSnapshotId?: string;
  connectorId?: string;
  enabled?: boolean;
  bindingConfigText?: string;
};

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

export default function ManageSkills() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [definitionForm] = Form.useForm<SkillDefinitionFormValues>();
  const [bindingForm] = Form.useForm<SkillBindingFormValues>();
  const [editingDefinition, setEditingDefinition] =
    useState<SkillDefinitionView | null>(null);
  const [editingBinding, setEditingBinding] = useState<SkillBindingView | null>(
    null,
  );
  const [definitionModalOpen, setDefinitionModalOpen] = useState(false);
  const [bindingModalOpen, setBindingModalOpen] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);

  const { data, loading, refetch } = useQuery<SkillControlPlaneData>(
    SKILL_CONTROL_PLANE,
    {
      fetchPolicy: 'cache-and-network',
      skip: !runtimeScopePage.hasRuntimeScope,
    },
  );

  const [createSkillDefinition, { loading: creatingDefinition }] = useMutation(
    CREATE_SKILL_DEFINITION,
  );
  const [updateSkillDefinition, { loading: updatingDefinition }] = useMutation(
    UPDATE_SKILL_DEFINITION,
  );
  const [deleteSkillDefinition] = useMutation(DELETE_SKILL_DEFINITION);
  const [createSkillBinding, { loading: creatingBinding }] = useMutation(
    CREATE_SKILL_BINDING,
  );
  const [updateSkillBinding, { loading: updatingBinding }] = useMutation(
    UPDATE_SKILL_BINDING,
  );
  const [deleteSkillBinding] = useMutation(DELETE_SKILL_BINDING);

  const runtimeSelectorState = data?.runtimeSelectorState;
  const skillDefinitions = data?.skillDefinitions || [];
  const skillBindings = data?.skillBindings || [];

  const skillDefinitionOptions = useMemo(
    () =>
      skillDefinitions.map((definition) => ({
        label: definition.name,
        value: definition.id,
      })),
    [skillDefinitions],
  );

  const snapshotOptions = useMemo(() => {
    const snapshots = runtimeSelectorState?.kbSnapshots || [];
    return [
      { label: 'Current / all snapshots', value: '' },
      ...snapshots.map((snapshot) => ({
        label: snapshot.displayName,
        value: snapshot.id,
      })),
    ];
  }, [runtimeSelectorState?.kbSnapshots]);

  const skillDefinitionNameMap = useMemo(
    () =>
      new Map(skillDefinitions.map((definition) => [definition.id, definition])),
    [skillDefinitions],
  );

  const connectorOptions = useMemo(
    () => buildSkillConnectorOptions(connectors),
    [connectors],
  );

  useEffect(() => {
    if (!runtimeScopePage.hasRuntimeScope) {
      setConnectors([]);
      return;
    }

    let cancelled = false;

    const fetchConnectors = async () => {
      setConnectorsLoading(true);
      try {
        const response = await fetch(buildSkillConnectorsApiUrl());
        if (!response.ok) {
          throw new Error(`Failed to load connectors: ${response.status}`);
        }

        const payload = await response.json();
        if (!cancelled) {
          setConnectors(Array.isArray(payload) ? payload : []);
        }
      } catch (error) {
        if (!cancelled) {
          setConnectors([]);
          message.error('Failed to load connectors for skill bindings.');
        }
      } finally {
        if (!cancelled) {
          setConnectorsLoading(false);
        }
      }
    };

    void fetchConnectors();

    return () => {
      cancelled = true;
    };
  }, [runtimeScopePage.hasRuntimeScope, runtimeSelectorState?.currentKnowledgeBase?.id]);

  const refresh = async () => {
    await refetch();
  };

  const openCreateDefinitionModal = () => {
    setEditingDefinition(null);
    definitionForm.resetFields();
    definitionForm.setFieldsValue({
      runtimeKind: 'isolated_python',
      sourceType: 'inline',
    });
    setDefinitionModalOpen(true);
  };

  const openEditDefinitionModal = (definition: SkillDefinitionView) => {
    setEditingDefinition(definition);
    definitionForm.setFieldsValue({
      name: definition.name,
      runtimeKind: definition.runtimeKind,
      sourceType: definition.sourceType,
      sourceRef: definition.sourceRef || undefined,
      entrypoint: definition.entrypoint || undefined,
      manifestText: stringifyJson(definition.manifest),
    });
    setDefinitionModalOpen(true);
  };

  const openCreateBindingModal = () => {
    setEditingBinding(null);
    bindingForm.resetFields();
    bindingForm.setFieldsValue({
      kbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id || '',
      enabled: true,
    });
    setBindingModalOpen(true);
  };

  const openEditBindingModal = (binding: SkillBindingView) => {
    setEditingBinding(binding);
    bindingForm.setFieldsValue({
      skillDefinitionId: binding.skillDefinitionId,
      kbSnapshotId: binding.kbSnapshotId || '',
      connectorId: binding.connectorId || undefined,
      enabled: binding.enabled,
      bindingConfigText: stringifyJson(binding.bindingConfig),
    });
    setBindingModalOpen(true);
  };

  const submitDefinition = async () => {
    try {
      const values = await definitionForm.validateFields();
      const payload = {
        name: values.name.trim(),
        runtimeKind: values.runtimeKind?.trim() || undefined,
        sourceType: values.sourceType?.trim() || undefined,
        sourceRef: values.sourceRef?.trim() || null,
        entrypoint: values.entrypoint?.trim() || null,
        manifest: parseOptionalJsonObject(values.manifestText),
      };

      if (editingDefinition) {
        await updateSkillDefinition({
          variables: { where: { id: editingDefinition.id }, data: payload },
        });
        message.success('Successfully updated skill.');
      } else {
        await createSkillDefinition({ variables: { data: payload } });
        message.success('Successfully created skill.');
      }

      setDefinitionModalOpen(false);
      definitionForm.resetFields();
      setEditingDefinition(null);
      await refresh();
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      message.error(error.message || 'Failed to save skill.');
    }
  };

  const submitBinding = async () => {
    try {
      const values = await bindingForm.validateFields();
      const payload = {
        skillDefinitionId: values.skillDefinitionId,
        kbSnapshotId: values.kbSnapshotId || null,
        connectorId: values.connectorId?.trim() || null,
        enabled: values.enabled ?? true,
        bindingConfig: parseOptionalJsonObject(values.bindingConfigText),
      };

      if (editingBinding) {
        await updateSkillBinding({
          variables: { where: { id: editingBinding.id }, data: payload },
        });
        message.success('Successfully updated skill binding.');
      } else {
        await createSkillBinding({ variables: { data: payload } });
        message.success('Successfully created skill binding.');
      }

      setBindingModalOpen(false);
      bindingForm.resetFields();
      setEditingBinding(null);
      await refresh();
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      message.error(error.message || 'Failed to save skill binding.');
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
            <CodeOutlined className="mr-2 gray-8" />
            Manage skills
          </>
        }
        description={
          <>
            Skills are workspace-level capability definitions. Bindings attach a
            skill to the active knowledge base and optional snapshot so ask can
            route into it without relying on legacy project-only knowledge.
          </>
        }
      >
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Card
              title="Skill definitions"
              extra={
                <Button type="primary" onClick={openCreateDefinitionModal}>
                  Add skill
                </Button>
              }
            >
              <Paragraph className="gray-7">
                Workspace:{' '}
                <Text strong>
                  {runtimeSelectorState?.currentWorkspace?.name || 'Unknown'}
                </Text>
              </Paragraph>
              <Table
                rowKey="id"
                pagination={{ hideOnSinglePage: true, pageSize: 10, size: 'small' }}
                dataSource={skillDefinitions}
                columns={[
                  {
                    title: 'Name',
                    dataIndex: 'name',
                    render: (value: string, record: SkillDefinitionView) => (
                      <Space direction="vertical" size={0}>
                        <Text strong>{value}</Text>
                        <Text type="secondary">
                          {record.runtimeKind} / {record.sourceType}
                        </Text>
                      </Space>
                    ),
                  },
                  {
                    title: 'Source',
                    dataIndex: 'sourceRef',
                    render: (_value: string, record: SkillDefinitionView) => (
                      <Space direction="vertical" size={0}>
                        <Text>{record.sourceRef || 'inline'}</Text>
                        <Text type="secondary">
                          {record.entrypoint || 'no entrypoint'}
                        </Text>
                      </Space>
                    ),
                  },
                  {
                    title: 'Manifest',
                    dataIndex: 'manifest',
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
                    title: 'Actions',
                    key: 'actions',
                    width: 160,
                    render: (_: any, record: SkillDefinitionView) => (
                      <Space>
                        <Button size="small" onClick={() => openEditDefinitionModal(record)}>
                          Edit
                        </Button>
                        <Popconfirm
                          title="Delete this skill?"
                          onConfirm={async () => {
                            await deleteSkillDefinition({
                              variables: { where: { id: record.id } },
                            });
                            message.success('Successfully deleted skill.');
                            await refresh();
                          }}
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
          </Col>

          <Col span={24}>
            <Card
              title="Skill bindings"
              extra={
                <Space>
                  <Link href={runtimeScopeNavigation.href(Path.KnowledgeConnectors)}>
                    Manage connectors
                  </Link>
                  <Button
                    type="primary"
                    onClick={openCreateBindingModal}
                    disabled={skillDefinitions.length === 0}
                  >
                    Add binding
                  </Button>
                </Space>
              }
            >
              <Paragraph className="gray-7">
                Knowledge base:{' '}
                <Text strong>
                  {runtimeSelectorState?.currentKnowledgeBase?.name || 'Unknown'}
                </Text>
              </Paragraph>
              {connectors.length === 0 && (
                <Paragraph className="gray-7">
                  No connectors configured yet.{' '}
                  <Link href={runtimeScopeNavigation.href(Path.KnowledgeConnectors)}>
                    Create a connector
                  </Link>{' '}
                  if this skill needs an API, database, or tool endpoint.
                </Paragraph>
              )}
              <Table
                rowKey="id"
                pagination={{ hideOnSinglePage: true, pageSize: 10, size: 'small' }}
                dataSource={skillBindings}
                columns={[
                  {
                    title: 'Skill',
                    dataIndex: 'skillDefinitionId',
                    render: (value: string) => {
                      const skillDefinition = skillDefinitionNameMap.get(value);
                      return (
                        <Space direction="vertical" size={0}>
                          <Text strong>
                            {skillDefinition?.name || value}
                          </Text>
                          <Text type="secondary">{value}</Text>
                        </Space>
                      );
                    },
                  },
                  {
                    title: 'Binding scope',
                    render: (_: any, record: SkillBindingView) => (
                      <Space direction="vertical" size={0}>
                        <Text>
                          Snapshot:{' '}
                          {record.kbSnapshotId
                            ? runtimeSelectorState?.kbSnapshots?.find(
                                (snapshot) => snapshot.id === record.kbSnapshotId,
                              )?.displayName || record.kbSnapshotId
                            : 'all/current'}
                        </Text>
                        <Text type="secondary">
                          Connector: {record.connectorId || 'none'}
                        </Text>
                      </Space>
                    ),
                  },
                  {
                    title: 'Status',
                    dataIndex: 'enabled',
                    width: 120,
                    render: (enabled: boolean) =>
                      enabled ? <Tag color="green">Enabled</Tag> : <Tag>Disabled</Tag>,
                  },
                  {
                    title: 'Binding config',
                    dataIndex: 'bindingConfig',
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
                    title: 'Actions',
                    key: 'actions',
                    width: 160,
                    render: (_: any, record: SkillBindingView) => (
                      <Space>
                        <Button size="small" onClick={() => openEditBindingModal(record)}>
                          Edit
                        </Button>
                        <Popconfirm
                          title="Delete this binding?"
                          onConfirm={async () => {
                            await deleteSkillBinding({
                              variables: { where: { id: record.id } },
                            });
                            message.success('Successfully deleted skill binding.');
                            await refresh();
                          }}
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
          </Col>
        </Row>

        <Modal
          title={editingDefinition ? 'Edit skill' : 'Add skill'}
          visible={definitionModalOpen}
          onCancel={() => {
            setDefinitionModalOpen(false);
            setEditingDefinition(null);
          }}
          onOk={submitDefinition}
          confirmLoading={creatingDefinition || updatingDefinition}
          destroyOnClose
        >
          <Form layout="vertical" form={definitionForm}>
            <Form.Item
              name="name"
              label="Name"
              rules={[{ required: true, message: 'Skill name is required' }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="runtimeKind" label="Runtime kind">
              <Input placeholder="isolated_python" />
            </Form.Item>
            <Form.Item name="sourceType" label="Source type">
              <Input placeholder="inline / api / db" />
            </Form.Item>
            <Form.Item name="sourceRef" label="Source ref">
              <Input placeholder="Optional external or inline source reference" />
            </Form.Item>
            <Form.Item name="entrypoint" label="Entrypoint">
              <Input placeholder="module:function or path" />
            </Form.Item>
            <Form.Item name="manifestText" label="Manifest JSON">
              <Input.TextArea
                rows={8}
                placeholder='{"timeoutMs": 30000, "network": {"allow": ["api.example.com"]}}'
              />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title={editingBinding ? 'Edit skill binding' : 'Add skill binding'}
          visible={bindingModalOpen}
          onCancel={() => {
            setBindingModalOpen(false);
            setEditingBinding(null);
          }}
          onOk={submitBinding}
          confirmLoading={creatingBinding || updatingBinding}
          destroyOnClose
        >
          <Form layout="vertical" form={bindingForm}>
            <Form.Item
              name="skillDefinitionId"
              label="Skill definition"
              rules={[{ required: true, message: 'Choose a skill definition' }]}
            >
              <Select options={skillDefinitionOptions} showSearch />
            </Form.Item>
            <Form.Item name="kbSnapshotId" label="Snapshot scope">
              <Select options={snapshotOptions} />
            </Form.Item>
            <Form.Item name="connectorId" label="Connector">
              <Select
                options={connectorOptions}
                placeholder="Optional connector"
                loading={connectorsLoading}
                allowClear
              />
            </Form.Item>
            <Form.Item name="enabled" label="Enabled" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="bindingConfigText" label="Binding config JSON">
              <Input.TextArea
                rows={8}
                placeholder='{"toolName": "db_sales_skill", "temperature": 0}'
              />
            </Form.Item>
          </Form>
        </Modal>
      </PageLayout>
    </SiderLayout>
  );
}
