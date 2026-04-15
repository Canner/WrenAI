import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import CodeOutlined from '@ant-design/icons/CodeOutlined';
import styled from 'styled-components';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeSelectorState, {
  type RuntimeSelectorState,
} from '@/hooks/useRuntimeSelectorState';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';
import useSkillsControlPlaneData from '@/hooks/useSkillsControlPlaneData';
import { Path } from '@/utils/enum';
import {
  getReferenceDisplayKnowledgeName,
  getReferenceDisplayWorkspaceName,
} from '@/utils/referenceDemoKnowledge';
import {
  createSkillDefinitionRecord,
  deleteSkillDefinitionRecord,
  installSkillMarketplaceCatalog,
  type SkillDefinitionView,
  type SkillMarketplaceCatalogView,
  updateSkillDefinitionRecord,
} from '@/utils/skillsRest';

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

type SkillDefinitionFormValues = {
  name: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string;
  entrypoint?: string;
  manifestText?: string;
  secretText?: string;
  instruction?: string;
  executionMode?: 'inject_only';
  connectorId?: string;
  enabled?: boolean;
  kbSuggestionIdsText?: string;
  runtimeConfigText?: string;
};

const MetricGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
`;

const MetricCard = styled.div`
  border-radius: 22px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: linear-gradient(
    180deg,
    rgba(245, 240, 255, 0.96) 0%,
    rgba(255, 255, 255, 0.98) 100%
  );
  padding: 18px 18px 16px;
  min-height: 112px;
`;

const MetricLabel = styled.span`
  display: block;
  font-size: 12px;
  color: #8c94a8;
  margin-bottom: 8px;
`;

const MetricValue = styled.span`
  display: block;
  font-size: 24px;
  line-height: 1.15;
  font-weight: 700;
  color: #242a39;
  margin-bottom: 6px;
`;

const MetricMeta = styled.span`
  display: block;
  font-size: 13px;
  color: #667085;
`;

const PanelGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
`;

export const buildSkillConnectorOptions = (connectors: ConnectorView[]) => [
  { label: '无连接器', value: '' },
  ...connectors.map((connector) => ({
    label: `${connector.displayName} (${connector.type})`,
    value: connector.id,
  })),
];

export const buildSkillConnectorsApiUrl = (
  selector?: Parameters<typeof buildRuntimeScopeUrl>[2],
) => buildRuntimeScopeUrl('/api/v1/connectors', {}, selector);

export const SKILL_SECRET_EDIT_HINT =
  '技能密钥仅作为后端运行时上下文使用，不会在前端回显明文。留空表示保留现有密钥。';
export const SKILL_CLEAR_SECRET_LABEL = '清空现有技能密钥';

const parseOptionalJsonObject = (value?: string) => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = JSON.parse(value);
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    throw new Error('JSON 内容必须是对象');
  }

  return parsed;
};

const parseOptionalStringArray = (value?: string) => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

const stringifyJson = (value?: Record<string, any> | null) =>
  value ? JSON.stringify(value, null, 2) : '';

const stringifyStringArray = (values?: string[] | null) =>
  Array.isArray(values) && values.length > 0 ? values.join('\n') : '';

export const buildSkillDefinitionSubmitPayload = ({
  values,
  editing,
  clearSecret,
}: {
  values: SkillDefinitionFormValues;
  editing: boolean;
  clearSecret: boolean;
}) => {
  const payload: Record<string, any> = {
    name: values.name.trim(),
    runtimeKind: values.runtimeKind?.trim() || undefined,
    sourceType: values.sourceType?.trim() || undefined,
    sourceRef: values.sourceRef?.trim() || null,
    entrypoint: values.entrypoint?.trim() || null,
    manifest: parseOptionalJsonObject(values.manifestText),
    instruction: values.instruction?.trim() || null,
    executionMode: values.executionMode || 'inject_only',
    connectorId: values.connectorId?.trim() || null,
    isEnabled: values.enabled ?? true,
    runtimeConfig: parseOptionalJsonObject(values.runtimeConfigText),
    kbSuggestionIds: parseOptionalStringArray(values.kbSuggestionIdsText),
  };

  if (editing && clearSecret) {
    payload.secret = null;
    return payload;
  }

  const secretText = values.secretText?.trim();
  if (!editing || secretText) {
    payload.secret = parseOptionalJsonObject(values.secretText);
  }

  return payload;
};

const getInstalledFromLabel = (installedFrom?: string | null) => {
  switch (installedFrom) {
    case 'builtin':
      return '内置';
    case 'marketplace':
      return '市场';
    case 'migrated_from_binding':
      return '迁移';
    default:
      return '自建';
  }
};

export default function ManageSkills() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeSelector = useRuntimeSelectorState();
  const authSession = useAuthSession();
  const showPlatformManagement = Boolean(
    authSession.data?.authorization?.actor?.platformRoleKeys?.includes(
      'platform_admin',
    ) ||
      authSession.data?.authorization?.actor?.isPlatformAdmin ||
      authSession.data?.isPlatformAdmin,
  );
  const [definitionForm] = Form.useForm<SkillDefinitionFormValues>();
  const [editingDefinition, setEditingDefinition] =
    useState<SkillDefinitionView | null>(null);
  const [definitionModalOpen, setDefinitionModalOpen] = useState(false);
  const [clearDefinitionSecretChecked, setClearDefinitionSecretChecked] =
    useState(false);
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [definitionSubmitting, setDefinitionSubmitting] = useState(false);
  const [installingCatalogId, setInstallingCatalogId] = useState<string | null>(
    null,
  );
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null);
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState as Pick<
    RuntimeSelectorState,
    | 'currentWorkspace'
    | 'currentKnowledgeBase'
    | 'currentKbSnapshot'
    | 'kbSnapshots'
  > | null;
  const handleControlPlaneLoadError = useCallback((error: Error) => {
    message.error(error.message || '加载技能失败，请稍后重试。');
  }, []);
  const { data, loading, refetch } = useSkillsControlPlaneData({
    enabled: runtimeScopePage.hasRuntimeScope,
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    onError: handleControlPlaneLoadError,
  });
  const marketplaceCatalogSkills = data.marketplaceCatalogSkills;
  const skillDefinitions = data.skillDefinitions;
  const authorizationActions = authSession.data?.authorization?.actions || {};
  const hasAuthCapabilities = Object.keys(authorizationActions).length > 0;
  const canCreateSkill = hasAuthCapabilities
    ? Boolean(authorizationActions['skill.create'])
    : true;
  const canUpdateSkill = hasAuthCapabilities
    ? Boolean(authorizationActions['skill.update'])
    : true;
  const canDeleteSkill = hasAuthCapabilities
    ? Boolean(authorizationActions['skill.delete'])
    : true;
  const canManageAnySkillAction =
    canCreateSkill || canUpdateSkill || canDeleteSkill;
  const skillManagementBlockedReason = canManageAnySkillAction
    ? null
    : '当前账号没有技能管理权限';

  const connectorOptions = useMemo(
    () => buildSkillConnectorOptions(connectors),
    [connectors],
  );
  const installedCatalogIds = useMemo(
    () =>
      new Set(
        skillDefinitions
          .map((definition) => definition.catalogId || null)
          .filter(Boolean),
      ),
    [skillDefinitions],
  );
  const enabledSkillCount = useMemo(
    () => skillDefinitions.filter((skill) => skill.isEnabled !== false).length,
    [skillDefinitions],
  );
  const connectorsApiUrl = useMemo(
    () => buildSkillConnectorsApiUrl(runtimeScopeNavigation.selector),
    [runtimeScopeNavigation.selector],
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
        const response = await fetch(connectorsApiUrl);
        if (!response.ok) {
          throw new Error(`加载连接器失败：${response.status}`);
        }

        const payload = await response.json();
        if (!cancelled) {
          setConnectors(Array.isArray(payload) ? payload : []);
        }
      } catch (_error) {
        if (!cancelled) {
          setConnectors([]);
          message.error('加载技能所需连接器失败。');
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
  }, [connectorsApiUrl, runtimeScopePage.hasRuntimeScope]);

  const refresh = async () => {
    await refetch();
  };

  const openCreateDefinitionModal = () => {
    if (!canCreateSkill) {
      message.info('当前账号没有创建技能权限');
      return;
    }
    setEditingDefinition(null);
    setClearDefinitionSecretChecked(false);
    definitionForm.resetFields();
    definitionForm.setFieldsValue({
      runtimeKind: 'isolated_python',
      sourceType: 'inline',
      executionMode: 'inject_only',
      enabled: true,
      secretText: '',
      instruction: '',
      kbSuggestionIdsText: '',
      runtimeConfigText: '',
    });
    setDefinitionModalOpen(true);
  };

  const openEditDefinitionModal = (definition: SkillDefinitionView) => {
    if (!canUpdateSkill) {
      message.info('当前账号没有编辑技能权限');
      return;
    }
    setEditingDefinition(definition);
    setClearDefinitionSecretChecked(false);
    definitionForm.setFieldsValue({
      name: definition.name,
      runtimeKind: definition.runtimeKind,
      sourceType: definition.sourceType,
      sourceRef: definition.sourceRef || undefined,
      entrypoint: definition.entrypoint || undefined,
      manifestText: stringifyJson(definition.manifest),
      secretText: '',
      instruction: definition.instruction || '',
      executionMode: definition.executionMode || 'inject_only',
      connectorId: definition.connectorId || undefined,
      enabled: definition.isEnabled !== false,
      kbSuggestionIdsText: stringifyStringArray(definition.kbSuggestionIds),
      runtimeConfigText: stringifyJson(definition.runtimeConfig),
    });
    setDefinitionModalOpen(true);
  };

  const closeDefinitionModal = () => {
    setDefinitionModalOpen(false);
    setEditingDefinition(null);
    setClearDefinitionSecretChecked(false);
    definitionForm.resetFields();
  };

  const submitDefinition = async () => {
    const hasPermission = editingDefinition ? canUpdateSkill : canCreateSkill;
    if (!hasPermission) {
      message.info(
        editingDefinition
          ? '当前账号没有编辑技能权限'
          : '当前账号没有创建技能权限',
      );
      return;
    }
    try {
      setDefinitionSubmitting(true);
      const values = await definitionForm.validateFields();
      const payload = buildSkillDefinitionSubmitPayload({
        values,
        editing: Boolean(editingDefinition),
        clearSecret: clearDefinitionSecretChecked,
      });

      if (editingDefinition) {
        await updateSkillDefinitionRecord(
          runtimeScopeNavigation.selector,
          editingDefinition.id,
          payload,
        );
        message.success('技能已更新。');
      } else {
        await createSkillDefinitionRecord(
          runtimeScopeNavigation.selector,
          payload,
        );
        message.success('技能已创建。');
      }

      closeDefinitionModal();
      await refresh();
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      message.error(error.message || '保存技能失败。');
    } finally {
      setDefinitionSubmitting(false);
    }
  };

  const handleInstallSkill = async (catalogId: string) => {
    if (!canCreateSkill) {
      message.info('当前账号没有安装技能权限');
      return;
    }
    try {
      setInstallingCatalogId(catalogId);
      await installSkillMarketplaceCatalog(
        runtimeScopeNavigation.selector,
        catalogId,
      );
      message.success('技能已安装。');
      await refresh();
    } catch (error: any) {
      message.error(error.message || '安装技能失败。');
    } finally {
      setInstallingCatalogId(null);
    }
  };

  const handleToggleSkill = async (skill: SkillDefinitionView) => {
    if (!canUpdateSkill) {
      message.info('当前账号没有变更技能状态的权限');
      return;
    }
    try {
      setTogglingSkillId(skill.id);
      await updateSkillDefinitionRecord(
        runtimeScopeNavigation.selector,
        skill.id,
        {
          isEnabled: !(skill.isEnabled !== false),
        },
      );
      message.success(
        skill.isEnabled !== false ? '技能已停用。' : '技能已启用。',
      );
      await refresh();
    } catch (error: any) {
      message.error(error.message || '切换技能状态失败。');
    } finally {
      setTogglingSkillId(null);
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    if (!canDeleteSkill) {
      message.info('当前账号没有删除技能权限');
      return;
    }
    try {
      setDeletingSkillId(skillId);
      await deleteSkillDefinitionRecord(
        runtimeScopeNavigation.selector,
        skillId,
      );
      message.success('技能已删除。');
      await refresh();
    } catch (error: any) {
      message.error(error.message || '删除技能失败。');
    } finally {
      setDeletingSkillId(null);
    }
  };

  if (runtimeScopePage.guarding) {
    return (
      <ConsoleShellLayout
        title="技能管理"
        description="管理工作区级运行时技能，并配置其指令、执行模式与连接器。"
        eyebrow="Workspace Skills"
        loading
        navItems={buildNovaSettingsNavItems({
          activeKey: 'settingsSkills',
          onNavigate: runtimeScopeNavigation.pushWorkspace,
          showPlatformAdmin: showPlatformManagement,
        })}
        hideHistorySection
        sidebarBackAction={{
          label: '返回主菜单',
          onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
        }}
      />
    );
  }

  return (
    <ConsoleShellLayout
      loading={loading || authSession.loading}
      title={
        <>
          <CodeOutlined className="mr-2 gray-8" />
          技能管理
        </>
      }
      description="以 workspace runtime skill 为主模型管理技能：市场负责发布来源，skill_definition 负责实际运行时配置。"
      eyebrow="Workspace Skills"
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsSkills',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: showPlatformManagement,
      })}
      hideHistorySection
      sidebarBackAction={{
        label: '返回主菜单',
        onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
      }}
    >
      <MetricGrid>
        <MetricCard>
          <MetricLabel>当前工作区</MetricLabel>
          <MetricValue>
            {getReferenceDisplayWorkspaceName(
              runtimeSelectorState?.currentWorkspace?.name,
            ) || '未知'}
          </MetricValue>
          <MetricMeta>
            技能以工作区级 runtime skill 形式沉淀并跨线程复用。
          </MetricMeta>
        </MetricCard>
        <MetricCard>
          <MetricLabel>运行时技能</MetricLabel>
          <MetricValue>{skillDefinitions.length}</MetricValue>
          <MetricMeta>
            已启用 {enabledSkillCount} 个，市场可安装{' '}
            {marketplaceCatalogSkills.length} 个。
          </MetricMeta>
        </MetricCard>
        <MetricCard>
          <MetricLabel>当前上下文</MetricLabel>
          <MetricValue>
            {getReferenceDisplayKnowledgeName(
              runtimeSelectorState?.currentKnowledgeBase?.name,
            ) || '未知'}
          </MetricValue>
          <MetricMeta>
            当前知识库只影响推荐与执行上下文，不再决定技能可用性的硬绑定。
          </MetricMeta>
        </MetricCard>
        <MetricCard>
          <MetricLabel>执行模式</MetricLabel>
          <MetricValue>inject_only</MetricValue>
          <MetricMeta>
            Ask 主链只保留 instruction 注入，不再提供 runner-first 预览路径。
          </MetricMeta>
        </MetricCard>
      </MetricGrid>

      <PanelGrid>
        <section className="console-panel">
          <div className="console-panel-header">
            <div>
              <div className="console-panel-title">技能市场</div>
              <div className="console-panel-subtitle">
                平台 catalog 只负责发布来源；安装后会物化成工作区自己的 runtime
                skill。
              </div>
            </div>
          </div>

          {skillManagementBlockedReason ? (
            <Paragraph type="secondary" className="gray-7">
              {skillManagementBlockedReason}
            </Paragraph>
          ) : null}

          <Table
            className="console-table"
            rowKey="id"
            locale={{ emptyText: '暂无可安装技能' }}
            pagination={{ hideOnSinglePage: true, pageSize: 10, size: 'small' }}
            dataSource={marketplaceCatalogSkills}
            columns={[
              {
                title: '技能',
                dataIndex: 'name',
                render: (
                  value: string,
                  record: SkillMarketplaceCatalogView,
                ) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{value}</Text>
                    <Text type="secondary">
                      {record.category || '未分类'} / {record.runtimeKind}
                    </Text>
                  </Space>
                ),
              },
              {
                title: '默认行为',
                render: (_: any, record: SkillMarketplaceCatalogView) => (
                  <Space direction="vertical" size={0}>
                    <Text>
                      执行模式：{record.defaultExecutionMode || 'inject_only'}
                    </Text>
                    <Text type="secondary">
                      {record.description || '无描述'}
                    </Text>
                  </Space>
                ),
              },
              {
                title: '状态',
                width: 120,
                render: (_: any, record: SkillMarketplaceCatalogView) =>
                  installedCatalogIds.has(record.id) ? (
                    <Tag color="green">已安装</Tag>
                  ) : record.isBuiltin ? (
                    <Tag color="blue">内置</Tag>
                  ) : (
                    <Tag>可安装</Tag>
                  ),
              },
              {
                title: '操作',
                width: 120,
                render: (_: any, record: SkillMarketplaceCatalogView) => (
                  <Button
                    size="small"
                    type="primary"
                    disabled={
                      installedCatalogIds.has(record.id) || !canCreateSkill
                    }
                    loading={installingCatalogId === record.id}
                    onClick={() => handleInstallSkill(record.id)}
                  >
                    {installedCatalogIds.has(record.id) ? '已安装' : '安装'}
                  </Button>
                ),
              },
            ]}
          />
        </section>

        <section className="console-panel">
          <div className="console-panel-header">
            <div>
              <div className="console-panel-title">我的技能</div>
              <div className="console-panel-subtitle">
                在 workspace runtime skill 上直接维护 instruction、execution
                mode、connector 与 KB 推荐。
              </div>
            </div>
            <Space wrap>
              <Link
                href={runtimeScopeNavigation.hrefWorkspace(
                  Path.SettingsConnectors,
                )}
              >
                管理连接器
              </Link>
              <Button
                type="primary"
                onClick={openCreateDefinitionModal}
                disabled={!canCreateSkill}
              >
                添加技能
              </Button>
            </Space>
          </div>

          {connectors.length === 0 ? (
            <Paragraph className="gray-7">
              当前还没有配置连接器。{' '}
              <Link
                href={runtimeScopeNavigation.hrefWorkspace(
                  Path.SettingsConnectors,
                )}
              >
                立即创建连接器
              </Link>
              ，当技能需要 API、数据库或工具端点时即可直接复用。
            </Paragraph>
          ) : null}

          <Table
            className="console-table"
            rowKey="id"
            locale={{ emptyText: '暂无技能' }}
            pagination={{ hideOnSinglePage: true, pageSize: 10, size: 'small' }}
            dataSource={skillDefinitions}
            columns={[
              {
                title: '技能',
                dataIndex: 'name',
                render: (value: string, record: SkillDefinitionView) => (
                  <Space direction="vertical" size={0}>
                    <Space wrap size={8}>
                      <Text strong>{value}</Text>
                      <Tag>{getInstalledFromLabel(record.installedFrom)}</Tag>
                      {record.catalogId ? (
                        <Tag color="purple">catalog</Tag>
                      ) : null}
                    </Space>
                    <Text type="secondary">
                      {record.runtimeKind} / {record.sourceType}
                    </Text>
                  </Space>
                ),
              },
              {
                title: '运行时配置',
                render: (_: any, record: SkillDefinitionView) => (
                  <Space direction="vertical" size={0}>
                    <Text>
                      执行模式：{record.executionMode || 'inject_only'}
                    </Text>
                    <Text type="secondary">
                      连接器：{record.connectorId || '无'}
                      {record.hasSecret ? ' · 已配置密钥' : ''}
                    </Text>
                  </Space>
                ),
              },
              {
                title: '指令 / 推荐范围',
                render: (_: any, record: SkillDefinitionView) => (
                  <Space direction="vertical" size={0}>
                    <Paragraph ellipsis={{ rows: 2 }} className="mb-0">
                      {record.instruction || '未设置 instruction'}
                    </Paragraph>
                    <Text type="secondary">
                      推荐知识库：
                      {record.kbSuggestionIds?.length
                        ? record.kbSuggestionIds
                            .map((knowledgeBaseId) => {
                              if (
                                runtimeSelectorState?.currentKnowledgeBase
                                  ?.id === knowledgeBaseId
                              ) {
                                return (
                                  runtimeSelectorState.currentKnowledgeBase
                                    .name || knowledgeBaseId
                                );
                              }

                              return knowledgeBaseId;
                            })
                            .join(' / ')
                        : '全工作区'}
                    </Text>
                  </Space>
                ),
              },
              {
                title: '状态',
                width: 140,
                render: (_: any, record: SkillDefinitionView) => (
                  <Space direction="vertical" size={4}>
                    {record.isEnabled !== false ? (
                      <Tag color="green">启用</Tag>
                    ) : (
                      <Tag>停用</Tag>
                    )}
                    {record.migrationSourceBindingId ? (
                      <Tag color="gold">迁移映射</Tag>
                    ) : null}
                  </Space>
                ),
              },
              {
                title: '操作',
                key: 'actions',
                width: 280,
                render: (_: any, record: SkillDefinitionView) => (
                  <Space wrap>
                    <Button
                      size="small"
                      onClick={() => openEditDefinitionModal(record)}
                      disabled={!canUpdateSkill}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      loading={togglingSkillId === record.id}
                      onClick={() => handleToggleSkill(record)}
                      disabled={!canUpdateSkill}
                    >
                      {record.isEnabled !== false ? '停用' : '启用'}
                    </Button>
                    <Popconfirm
                      title="确认删除这个技能吗？"
                      onConfirm={async () => {
                        await handleDeleteSkill(record.id);
                      }}
                      disabled={!canDeleteSkill}
                    >
                      <Button
                        size="small"
                        danger
                        disabled={!canDeleteSkill}
                        loading={deletingSkillId === record.id}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </section>
      </PanelGrid>

      <Modal
        title={editingDefinition ? '编辑技能' : '添加技能'}
        visible={definitionModalOpen}
        onCancel={closeDefinitionModal}
        onOk={submitDefinition}
        confirmLoading={definitionSubmitting}
        destroyOnClose
        width={760}
      >
        <Form layout="vertical" form={definitionForm}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入技能名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="runtimeKind" label="运行时类型">
            <Input placeholder="isolated_python" />
          </Form.Item>
          <Form.Item name="sourceType" label="来源类型">
            <Input placeholder="inline / api / db" />
          </Form.Item>
          <Form.Item name="sourceRef" label="来源引用">
            <Input placeholder="可选的外部地址或内联来源引用" />
          </Form.Item>
          <Form.Item name="entrypoint" label="入口点">
            <Input placeholder="module:function or path" />
          </Form.Item>
          <Form.Item name="instruction" label="Instruction">
            <Input.TextArea
              rows={4}
              placeholder="输入注入 Ask / NL2SQL 主链的领域规则"
            />
          </Form.Item>
          <Form.Item name="executionMode" label="执行模式">
            <Select
              options={[{ label: 'inject_only', value: 'inject_only' }]}
            />
          </Form.Item>
          <Form.Item name="connectorId" label="连接器">
            <Select
              options={connectorOptions}
              placeholder="可选连接器"
              loading={connectorsLoading}
              allowClear
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="kbSuggestionIdsText"
            label="推荐知识库 ID（每行一个）"
          >
            <Input.TextArea
              rows={3}
              placeholder="kb-1&#10;kb-2"
            />
          </Form.Item>
          <Form.Item name="runtimeConfigText" label="运行时配置 JSON">
            <Input.TextArea
              rows={6}
              placeholder='{"timeoutSec": 30, "toolName": "sales_skill"}'
            />
          </Form.Item>
          <Form.Item name="manifestText" label="清单 JSON">
            <Input.TextArea
              rows={6}
              placeholder='{"timeoutMs": 30000, "network": {"allow": ["api.example.com"]}}'
            />
          </Form.Item>
          <Paragraph className="gray-7">{SKILL_SECRET_EDIT_HINT}</Paragraph>
          <Form.Item name="secretText" label="技能密钥 JSON">
            <Input.TextArea
              rows={4}
              placeholder='{"apiKey": "sk-***", "baseUrl": "https://api.example.com"}'
              disabled={clearDefinitionSecretChecked}
            />
          </Form.Item>
          {editingDefinition?.hasSecret ? (
            <Form.Item label={SKILL_CLEAR_SECRET_LABEL}>
              <Switch
                checked={clearDefinitionSecretChecked}
                onChange={(checked) => setClearDefinitionSecretChecked(checked)}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </ConsoleShellLayout>
  );
}
