import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';
import {
  WORKSPACE_MEMBER_ROLE_OPTIONS,
  getWorkspaceRoleLabel,
} from '@/utils/workspaceGovernance';
import {
  resolvePlatformConsoleCapabilities,
  resolvePlatformManagementFromAuthSession,
} from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import {
  STATUS_LABELS,
  applicationStatusColor,
  formatAccountLabel,
  formatPhoneLabel,
} from '@/features/settings/users/usersPageUtils';

const { Text } = Typography;

type WorkspaceRow = {
  id: string;
  name: string;
  slug?: string | null;
  kind?: string | null;
  memberCount: number;
  ownerCount: number;
  viewerCount: number;
  pendingCount: number;
  canManageMembers: boolean;
  actorRoleKey?: string | null;
  resourceSummary?: {
    knowledgeBaseCount: number;
    connectorCount: number;
    skillCount: number;
  };
};

type WorkspaceApplicationRow = {
  id: string;
  workspaceId: string;
  roleKey: string;
  status: string;
  workspace?: { name: string; kind?: string | null } | null;
  user?: { displayName?: string | null; email?: string | null } | null;
};

type WorkspaceMemberRow = {
  id: string;
  userId: string;
  roleKey: string;
  status: string;
  user?: {
    email?: string | null;
    displayName?: string | null;
    phone?: string | null;
  } | null;
};

type WorkspaceDetailPayload = {
  workspace: WorkspaceRow;
  permissions: { canManageMembers: boolean };
  members: WorkspaceMemberRow[];
};

export default function ManagePlatformWorkspacesPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const platformCapabilities = resolvePlatformConsoleCapabilities(
    authSession.data,
  );
  const canAccessPage = platformCapabilities.canReadWorkspaces;
  const canCreateWorkspace = platformCapabilities.canCreateWorkspace;
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsWorkspace',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });

  const [activeTab, setActiveTab] = useState('workspaces');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [applications, setApplications] = useState<WorkspaceApplicationRow[]>(
    [],
  );
  const [ownerCandidates, setOwnerCandidates] = useState<
    Array<{ id: string; email: string; displayName?: string | null }>
  >([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<WorkspaceDetailPayload | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [memberAction, setMemberAction] = useState<{
    memberId: string;
    action: string;
  } | null>(null);
  const [workspaceForm] = Form.useForm<{
    name: string;
    slug?: string;
    initialOwnerUserId: string;
  }>();

  const loadWorkspaceOverview = useCallback(async () => {
    if (
      !runtimeScopePage.hasRuntimeScope ||
      !authSession.authenticated ||
      !canAccessPage
    ) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/platform/workspaces'),
        {
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '加载工作空间失败');
      }
      setWorkspaces(payload.workspaces || []);
      setApplications(payload.applications || []);
      setOwnerCandidates(payload.ownerCandidates || []);
    } catch (loadError: any) {
      setError(loadError?.message || '加载工作空间失败');
    } finally {
      setLoading(false);
    }
  }, [
    authSession.authenticated,
    canAccessPage,
    runtimeScopePage.hasRuntimeScope,
  ]);

  const loadWorkspaceDetail = useCallback(async (workspaceId: string) => {
    try {
      setDetailLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/platform/workspaces/${workspaceId}`),
        {
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '加载工作空间详情失败');
      }
      setDetail(payload);
      setSelectedWorkspaceId(workspaceId);
    } catch (detailError: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        detailError,
        '加载工作空间详情失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceOverview();
  }, [loadWorkspaceOverview]);

  const filteredWorkspaces = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return workspaces;
    }
    return workspaces.filter((workspace) =>
      [workspace.name, workspace.slug]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedKeyword),
    );
  }, [keyword, workspaces]);

  const filteredApplications = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return applications;
    }
    return applications.filter((application) =>
      [
        application.workspace?.name,
        application.user?.displayName,
        application.user?.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedKeyword),
    );
  }, [applications, keyword]);

  const refreshAll = useCallback(async () => {
    await loadWorkspaceOverview();
    if (selectedWorkspaceId) {
      await loadWorkspaceDetail(selectedWorkspaceId);
    }
  }, [loadWorkspaceDetail, loadWorkspaceOverview, selectedWorkspaceId]);

  const handleCreateWorkspace = useCallback(async () => {
    try {
      const values = await workspaceForm.validateFields();
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/platform/workspaces'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(values),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建工作空间失败');
      }
      message.success('工作空间已创建');
      workspaceForm.resetFields();
      setCreateModalOpen(false);
      await refreshAll();
    } catch (createError: any) {
      if (createError?.errorFields) {
        return;
      }
      const errorMessage = resolveAbortSafeErrorMessage(
        createError,
        '创建工作空间失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    }
  }, [refreshAll, workspaceForm]);

  const handleInviteMember = useCallback(async () => {
    if (!selectedWorkspaceId) {
      return false;
    }

    try {
      setMemberAction({ memberId: 'invite', action: 'invite' });
      const response = await fetch(
        buildRuntimeScopeUrl(
          `/api/v1/platform/workspaces/${selectedWorkspaceId}/members`,
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: inviteEmail, roleKey: inviteRole }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '邀请成员失败');
      }
      message.success('成员邀请已发送');
      setInviteEmail('');
      setInviteRole('viewer');
      await refreshAll();
      return true;
    } catch (inviteError: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        inviteError,
        '邀请成员失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      return false;
    } finally {
      setMemberAction(null);
    }
  }, [inviteEmail, inviteRole, refreshAll, selectedWorkspaceId]);

  const handleMemberMutation = useCallback(
    async (
      workspaceId: string,
      memberId: string,
      action: string,
      extra?: Record<string, unknown>,
      successMessage?: string,
    ) => {
      try {
        setMemberAction({ memberId, action });
        const response = await fetch(
          buildRuntimeScopeUrl(
            `/api/v1/platform/workspaces/${workspaceId}/members/${memberId}`,
          ),
          {
            method: action === 'remove' ? 'DELETE' : 'PATCH',
            headers:
              action === 'remove'
                ? undefined
                : { 'Content-Type': 'application/json' },
            credentials: 'include',
            body:
              action === 'remove'
                ? undefined
                : JSON.stringify({ action, ...(extra || {}) }),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '成员操作失败');
        }
        message.success(successMessage || '成员操作已完成');
        await refreshAll();
      } catch (mutationError: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          mutationError,
          successMessage || '成员操作失败',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      } finally {
        setMemberAction(null);
      }
    },
    [refreshAll],
  );

  const workspaceColumns: TableColumnsType<WorkspaceRow> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 260,
      render: (_value, record) => (
        <Space orientation="vertical" size={0}>
          <Text strong>{getReferenceDisplayWorkspaceName(record.name)}</Text>
          <Text type="secondary">{record.slug || '未配置 slug'}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 100,
      render: (value?: string | null) => <Tag>{value || 'regular'}</Tag>,
    },
    {
      title: '成员',
      key: 'members',
      width: 150,
      render: (_value, record) => (
        <Space orientation="vertical" size={0}>
          <Text>{record.memberCount} 人</Text>
          <Text type="secondary">
            Owner {record.ownerCount} / Viewer {record.viewerCount}
          </Text>
        </Space>
      ),
    },
    {
      title: '当前权限',
      key: 'actorRoleKey',
      width: 120,
      render: (_value, record) => (
        <Tag color={record.actorRoleKey === 'owner' ? 'purple' : 'blue'}>
          {record.actorRoleKey
            ? getWorkspaceRoleLabel(record.actorRoleKey)
            : '只读'}
        </Tag>
      ),
    },
    {
      title: '待审批',
      dataIndex: 'pendingCount',
      key: 'pendingCount',
      width: 100,
      render: (value: number) =>
        value > 0 ? (
          <Tag color="gold">{value}</Tag>
        ) : (
          <Text type="secondary">0</Text>
        ),
    },
    {
      title: '资源概览',
      key: 'resources',
      width: 260,
      render: (_value, record) => (
        <Space wrap>
          <Tag>知识库 {record.resourceSummary?.knowledgeBaseCount || 0}</Tag>
          <Tag>连接器 {record.resourceSummary?.connectorCount || 0}</Tag>
          <Tag>技能 {record.resourceSummary?.skillCount || 0}</Tag>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_value, record) => (
        <Button onClick={() => void loadWorkspaceDetail(record.id)}>
          {record.canManageMembers ? '成员管理' : '查看成员'}
        </Button>
      ),
    },
  ];

  const applicationColumns: TableColumnsType<WorkspaceApplicationRow> = [
    {
      title: '工作空间',
      key: 'workspace',
      render: (_value, record) => (
        <Space orientation="vertical" size={0}>
          <Text strong>
            {getReferenceDisplayWorkspaceName(record.workspace?.name || '—')}
          </Text>
          <Text type="secondary">{record.workspace?.kind || 'regular'}</Text>
        </Space>
      ),
    },
    {
      title: '申请人',
      key: 'user',
      render: (_value, record) => (
        <Space orientation="vertical" size={0}>
          <Text>{record.user?.displayName || '未命名用户'}</Text>
          <Text type="secondary">
            {formatAccountLabel(record.user?.email, record.id)}
          </Text>
        </Space>
      ),
    },
    {
      title: '申请权限',
      dataIndex: 'roleKey',
      key: 'roleKey',
      width: 120,
      render: (value: string) => (
        <Tag color={value === 'owner' ? 'purple' : 'blue'}>
          {getWorkspaceRoleLabel(value)}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => (
        <Tag color={applicationStatusColor(value)}>
          {STATUS_LABELS[value] || value}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_value, record) => {
        const workspace = workspaces.find(
          (item) => item.id === record.workspaceId,
        );
        if (!workspace?.canManageMembers) {
          return <Text type="secondary">只读</Text>;
        }

        return (
          <Space wrap>
            <Button
              type="primary"
              onClick={() =>
                void handleMemberMutation(
                  record.workspaceId,
                  record.id,
                  'approve',
                  undefined,
                  '申请已批准',
                )
              }
            >
              批准
            </Button>
            <Button
              danger
              onClick={() =>
                void handleMemberMutation(
                  record.workspaceId,
                  record.id,
                  'reject',
                  undefined,
                  '申请已拒绝',
                )
              }
            >
              拒绝
            </Button>
          </Space>
        );
      },
    },
  ];

  const memberColumns: TableColumnsType<WorkspaceMemberRow> = [
    {
      title: '姓名',
      key: 'displayName',
      width: 180,
      render: (_value, record) => (
        <Text strong>{record.user?.displayName || '未命名用户'}</Text>
      ),
    },
    {
      title: '账号',
      key: 'account',
      width: 220,
      render: (_value, record) => (
        <Space orientation="vertical" size={0}>
          <Text>{formatAccountLabel(record.user?.email, record.userId)}</Text>
          <Text type="secondary">{record.user?.email || '—'}</Text>
        </Space>
      ),
    },
    {
      title: '手机号',
      key: 'phone',
      width: 160,
      render: (_value, record) => formatPhoneLabel(record.user?.phone),
    },
    {
      title: '当前权限',
      key: 'roleKey',
      width: 160,
      render: (_value, record) => {
        const busy = Boolean(
          memberAction &&
          memberAction.memberId === record.id &&
          memberAction.action === 'updateRole',
        );

        if (!detail?.permissions.canManageMembers) {
          return (
            <Tag color={record.roleKey === 'owner' ? 'purple' : 'blue'}>
              {getWorkspaceRoleLabel(record.roleKey)}
            </Tag>
          );
        }

        return (
          <Select
            value={record.roleKey}
            style={{ width: 120 }}
            options={WORKSPACE_MEMBER_ROLE_OPTIONS as any}
            loading={busy}
            disabled={busy || record.status === 'rejected'}
            onChange={(value) => {
              if (!selectedWorkspaceId || value === record.roleKey) {
                return;
              }
              void handleMemberMutation(
                selectedWorkspaceId,
                record.id,
                'updateRole',
                { roleKey: value },
                '成员权限已更新',
              );
            }}
          />
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => (
        <Tag color={applicationStatusColor(value)}>
          {STATUS_LABELS[value] || value}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_value, record) => {
        if (!detail?.permissions.canManageMembers) {
          return <Text type="secondary">只读</Text>;
        }

        const busy = memberAction?.memberId === record.id;
        const actionButtons: JSX.Element[] = [];

        if (record.status === 'pending') {
          actionButtons.push(
            <Button
              key="approve"
              type="primary"
              loading={busy && memberAction?.action === 'approve'}
              onClick={() => {
                if (!selectedWorkspaceId) {
                  return;
                }
                void handleMemberMutation(
                  selectedWorkspaceId,
                  record.id,
                  'approve',
                  undefined,
                  '成员申请已批准',
                );
              }}
            >
              批准
            </Button>,
          );
          actionButtons.push(
            <Button
              key="reject"
              danger
              loading={busy && memberAction?.action === 'reject'}
              onClick={() => {
                if (!selectedWorkspaceId) {
                  return;
                }
                void handleMemberMutation(
                  selectedWorkspaceId,
                  record.id,
                  'reject',
                  undefined,
                  '成员申请已拒绝',
                );
              }}
            >
              拒绝
            </Button>,
          );
        } else if (
          record.status === 'inactive' ||
          record.status === 'rejected'
        ) {
          actionButtons.push(
            <Button
              key="reactivate"
              loading={busy && memberAction?.action === 'reactivate'}
              onClick={() => {
                if (!selectedWorkspaceId) {
                  return;
                }
                void handleMemberMutation(
                  selectedWorkspaceId,
                  record.id,
                  'reactivate',
                  undefined,
                  '成员已重新启用',
                );
              }}
            >
              启用
            </Button>,
          );
        } else {
          actionButtons.push(
            <Button
              key="deactivate"
              loading={busy && memberAction?.action === 'deactivate'}
              onClick={() => {
                if (!selectedWorkspaceId) {
                  return;
                }
                void handleMemberMutation(
                  selectedWorkspaceId,
                  record.id,
                  'deactivate',
                  undefined,
                  '成员已停用',
                );
              }}
            >
              停用
            </Button>,
          );
        }

        actionButtons.push(
          <Popconfirm
            key="remove"
            title="确认移除该成员吗？"
            onConfirm={() => {
              if (!selectedWorkspaceId) {
                return;
              }
              void handleMemberMutation(
                selectedWorkspaceId,
                record.id,
                'remove',
                undefined,
                '成员已移除',
              );
            }}
          >
            <Button danger loading={busy && memberAction?.action === 'remove'}>
              移除
            </Button>
          </Popconfirm>,
        );

        return <Space wrap>{actionButtons}</Space>;
      },
    },
  ];

  return (
    <ConsoleShellLayout
      title="工作空间管理"
      eyebrow="Workspace Governance"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="当前未登录"
          description="请先登录后再查看工作空间治理页。"
        />
      ) : !canAccessPage ? (
        <Alert
          className="console-alert"
          type="error"
          showIcon
          message="当前账号没有平台治理权限"
          description="平台工作空间管理仅对具备工作空间治理查看权限的角色开放。"
        />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          {error ? <Alert type="warning" showIcon message={error} /> : null}

          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Input.Search
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={
                activeTab === 'applications'
                  ? '搜索工作空间 / 申请人'
                  : '搜索工作空间名称'
              }
              style={{ width: 320 }}
            />
            {canCreateWorkspace ? (
              <Button type="primary" onClick={() => setCreateModalOpen(true)}>
                新建工作空间
              </Button>
            ) : null}
          </Space>

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'workspaces',
                label: '工作空间列表',
                children: (
                  <Table
                    className="console-table"
                    rowKey="id"
                    loading={loading}
                    columns={workspaceColumns}
                    dataSource={filteredWorkspaces}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    locale={{ emptyText: loading ? '加载中…' : '暂无工作空间' }}
                    scroll={{ x: 1110 }}
                  />
                ),
              },
              {
                key: 'applications',
                label: '申请记录',
                children: (
                  <Table
                    className="console-table"
                    rowKey="id"
                    loading={loading}
                    columns={applicationColumns}
                    dataSource={filteredApplications}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    locale={{
                      emptyText: loading ? '加载中…' : '暂无待审批申请',
                    }}
                    scroll={{ x: 980 }}
                  />
                ),
              },
            ]}
          />
        </Space>
      )}

      <Drawer
        open={Boolean(detail && selectedWorkspaceId)}
        size={980}
        title={`${detail?.workspace.name || '工作空间'} · 成员管理`}
        onClose={() => {
          setSelectedWorkspaceId(null);
          setDetail(null);
          setInviteEmail('');
          setInviteRole('viewer');
          setMemberAction(null);
        }}
      >
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Space wrap>
            <Tag>{detail?.workspace.kind || 'regular'}</Tag>
            <Tag>成员 {detail?.workspace.memberCount || 0}</Tag>
            <Tag>Owner {detail?.workspace.ownerCount || 0}</Tag>
            <Tag>Viewer {detail?.workspace.viewerCount || 0}</Tag>
            <Tag color="gold">待审批 {detail?.workspace.pendingCount || 0}</Tag>
            <Tag>
              知识库{' '}
              {detail?.workspace.resourceSummary?.knowledgeBaseCount || 0}
            </Tag>
            <Tag>
              连接器 {detail?.workspace.resourceSummary?.connectorCount || 0}
            </Tag>
            <Tag>技能 {detail?.workspace.resourceSummary?.skillCount || 0}</Tag>
          </Space>

          <Space
            align="end"
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <Text strong>成员列表</Text>
            {detail?.permissions.canManageMembers ? (
              <Space wrap>
                <Input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="输入用户邮箱邀请成员"
                  style={{ width: 240 }}
                />
                <Select
                  value={inviteRole}
                  style={{ width: 120 }}
                  options={WORKSPACE_MEMBER_ROLE_OPTIONS as any}
                  onChange={setInviteRole}
                />
                <Button
                  type="primary"
                  loading={memberAction?.action === 'invite'}
                  disabled={!inviteEmail.trim()}
                  onClick={() => void handleInviteMember()}
                >
                  邀请成员
                </Button>
              </Space>
            ) : null}
          </Space>

          <Table
            className="console-table"
            rowKey="id"
            loading={detailLoading}
            columns={memberColumns}
            dataSource={detail?.members || []}
            pagination={false}
            locale={{
              emptyText: detailLoading ? '加载中…' : '暂无成员数据',
            }}
            scroll={{ x: 1120 }}
          />
        </Space>
      </Drawer>

      <Modal
        open={createModalOpen}
        title="新建工作空间"
        destroyOnHidden
        onCancel={() => setCreateModalOpen(false)}
        onOk={() => void handleCreateWorkspace()}
        okText="创建"
      >
        <Form form={workspaceForm} layout="vertical">
          <Form.Item
            label="工作空间名称"
            name="name"
            rules={[{ required: true, message: '请输入工作空间名称' }]}
          >
            <Input placeholder="例如：运营分析" />
          </Form.Item>
          <Form.Item label="Slug（可选）" name="slug">
            <Input placeholder="ops-analytics" />
          </Form.Item>
          <Form.Item
            label="初始所有者"
            name="initialOwnerUserId"
            rules={[{ required: true, message: '请选择初始所有者' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={ownerCandidates.map((user) => ({
                label: `${user.displayName || user.email} · ${user.email}`,
                value: user.id,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </ConsoleShellLayout>
  );
}
