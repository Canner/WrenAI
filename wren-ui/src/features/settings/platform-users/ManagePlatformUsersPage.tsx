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
import {
  WORKSPACE_MEMBER_ROLE_OPTIONS,
  getWorkspaceRoleLabel,
} from '@/utils/workspaceGovernance';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';
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

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  platform_admin: '平台管理员',
  platform_iam_admin: '平台权限管理员',
  platform_workspace_admin: '平台空间管理员',
  platform_auditor: '平台审计员',
  support_readonly: '支持只读',
  support_impersonator: '支持代理员',
};

type WorkspaceMembershipView = {
  id: string;
  workspaceId: string;
  roleKey: string;
  status: string;
  workspace?: {
    id: string;
    name: string;
    kind?: string | null;
  } | null;
};

type PlatformRoleOption = {
  id: string;
  name: string;
  displayName: string;
  isSystem: boolean;
  isActive: boolean;
};

type PlatformUserRecord = {
  id: string;
  email: string;
  displayName?: string | null;
  phone?: string | null;
  status: string;
  isPlatformAdmin: boolean;
  platformRoleIds: string[];
  platformRoles: string[];
  platformRoleLabels: string[];
  defaultWorkspaceId?: string | null;
  defaultWorkspaceName?: string | null;
  workspaceCount: number;
  workspaces: WorkspaceMembershipView[];
};

type WorkspaceOption = {
  id: string;
  name: string;
  kind?: string | null;
};

type DetailPayload = {
  user: PlatformUserRecord;
  memberships: WorkspaceMembershipView[];
  availableWorkspaces: WorkspaceOption[];
};

type CreateUserFormValues = {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type EditUserFormValues = {
  displayName: string;
};

type RoleFormValues = {
  platformRoleIds: string[];
};

const platformRoleTag = (record: PlatformUserRecord) =>
  record.platformRoleLabels?.length ? (
    <Space size={[6, 6]} wrap>
      {record.platformRoleLabels.map((label, index) => (
        <Tag
          key={`${record.id}-${record.platformRoles[index] || label}`}
          color={
            record.platformRoles[index] === 'platform_admin' ? 'purple' : 'blue'
          }
        >
          {PLATFORM_ROLE_LABELS[record.platformRoles[index]] || label}
        </Tag>
      ))}
    </Space>
  ) : (
    <Tag>普通账号</Tag>
  );

export default function ManagePlatformUsersPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const platformCapabilities = resolvePlatformConsoleCapabilities(
    authSession.data,
  );
  const canAccessPage = platformCapabilities.canReadUsers;
  const canCreateUsers = platformCapabilities.canCreateUsers;
  const canUpdateUsers = platformCapabilities.canUpdateUsers;
  const canAssignPlatformRoles = platformCapabilities.canAssignPlatformRoles;
  const canAssignUserWorkspaces = platformCapabilities.canAssignUserWorkspaces;
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsUsers',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [users, setUsers] = useState<PlatformUserRecord[]>([]);
  const [platformRoleCatalog, setPlatformRoleCatalog] = useState<
    PlatformRoleOption[]
  >([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editingUser, setEditingUser] = useState<PlatformUserRecord | null>(
    null,
  );
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleSubmitting, setRoleSubmitting] = useState(false);
  const [roleUser, setRoleUser] = useState<PlatformUserRecord | null>(null);
  const [workspaceForm] = Form.useForm<{
    workspaceId: string;
    roleKey: string;
  }>();
  const [createForm] = Form.useForm<CreateUserFormValues>();
  const [editForm] = Form.useForm<EditUserFormValues>();
  const [roleForm] = Form.useForm<RoleFormValues>();

  const loadUsers = useCallback(async () => {
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
        buildRuntimeScopeUrl('/api/v1/platform/users'),
        {
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '加载平台用户失败');
      }
      setUsers(payload.users || []);
      setPlatformRoleCatalog(payload.platformRoleCatalog || []);
    } catch (loadError: any) {
      setError(loadError?.message || '加载平台用户失败');
    } finally {
      setLoading(false);
    }
  }, [
    authSession.authenticated,
    canAccessPage,
    runtimeScopePage.hasRuntimeScope,
  ]);

  const loadUserDetail = useCallback(async (userId: string) => {
    try {
      setDetailLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/platform/users/${userId}/workspaces`),
        {
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '加载用户详情失败');
      }
      setDetail({
        user: payload.user,
        memberships: payload.memberships || [],
        availableWorkspaces: payload.availableWorkspaces || [],
      });
      if (payload.platformRoleCatalog) {
        setPlatformRoleCatalog(payload.platformRoleCatalog);
      }
      setSelectedUserId(userId);
    } catch (detailError: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        detailError,
        '加载用户详情失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return users;
    }

    return users.filter((user) =>
      [
        user.displayName,
        user.email,
        formatAccountLabel(user.email, user.id),
        user.defaultWorkspaceName,
        ...(user.platformRoleLabels || []),
        ...(user.platformRoles || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedKeyword),
    );
  }, [keyword, users]);

  const refreshUserState = useCallback(
    async (
      userId?: string | null,
      options?: {
        refreshDetail?: boolean;
      },
    ) => {
      await loadUsers();
      const targetUserId = userId || selectedUserId;
      if (options?.refreshDetail && targetUserId) {
        await loadUserDetail(targetUserId);
      }
    },
    [loadUserDetail, loadUsers, selectedUserId],
  );

  const patchUser = useCallback(
    async (
      userId: string,
      body: Record<string, unknown>,
      successMessage: string,
    ) => {
      try {
        setDetailLoading(true);
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/platform/users/${userId}`),
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || successMessage);
        }
        message.success(successMessage);
        await refreshUserState(userId, {
          refreshDetail: selectedUserId === userId,
        });
        return true;
      } catch (patchError: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          patchError,
          successMessage,
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        return false;
      } finally {
        setDetailLoading(false);
      }
    },
    [refreshUserState],
  );

  const handleCreateUser = useCallback(async () => {
    try {
      const values = await createForm.validateFields();
      setCreateSubmitting(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/platform/users'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            displayName: values.displayName,
            email: values.email,
            password: values.password,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '新增用户失败');
      }
      message.success('用户已创建');
      createForm.resetFields();
      setCreateModalOpen(false);
      await loadUsers();
    } catch (createError: any) {
      if (createError?.errorFields) {
        return;
      }
      const errorMessage = resolveAbortSafeErrorMessage(
        createError,
        '新增用户失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setCreateSubmitting(false);
    }
  }, [createForm, loadUsers]);

  const handleEditUser = useCallback(async () => {
    if (!editingUser) {
      return;
    }

    try {
      const values = await editForm.validateFields();
      setEditSubmitting(true);
      const updated = await patchUser(
        editingUser.id,
        { displayName: values.displayName },
        '用户信息已更新',
      );
      if (updated) {
        setEditModalOpen(false);
        setEditingUser(null);
      }
    } catch (editError: any) {
      if (!editError?.errorFields) {
        const errorMessage = resolveAbortSafeErrorMessage(
          editError,
          '用户信息更新失败',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    } finally {
      setEditSubmitting(false);
    }
  }, [editForm, editingUser, patchUser]);

  const handleSubmitRole = useCallback(async () => {
    if (!roleUser) {
      return;
    }

    try {
      const values = await roleForm.validateFields();
      setRoleSubmitting(true);
      const updated = await patchUser(
        roleUser.id,
        { platformRoleIds: values.platformRoleIds || [] },
        '平台角色已更新',
      );
      if (updated) {
        setRoleModalOpen(false);
        setRoleUser(null);
      }
    } catch (roleError: any) {
      if (!roleError?.errorFields) {
        const errorMessage = resolveAbortSafeErrorMessage(
          roleError,
          '角色调整失败',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    } finally {
      setRoleSubmitting(false);
    }
  }, [patchUser, roleForm, roleUser]);

  const handleSubmitWorkspace = useCallback(async () => {
    if (!selectedUserId) {
      return;
    }

    try {
      const values = await workspaceForm.validateFields();
      const response = await fetch(
        buildRuntimeScopeUrl(
          `/api/v1/platform/users/${selectedUserId}/workspaces`,
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(values),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '分配工作空间失败');
      }
      message.success('工作空间分配已更新');
      workspaceForm.resetFields();
      setWorkspaceModalOpen(false);
      await refreshUserState(selectedUserId, { refreshDetail: true });
    } catch (submitError: any) {
      if (submitError?.errorFields) {
        return;
      }
      const errorMessage = resolveAbortSafeErrorMessage(
        submitError,
        '分配工作空间失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    }
  }, [refreshUserState, selectedUserId, workspaceForm]);

  const handleWorkspaceAction = useCallback(
    async ({
      membershipId,
      workspaceId,
      action,
      roleKey,
      successMessage,
    }: {
      membershipId: string;
      workspaceId: string;
      action: 'updateRole' | 'remove';
      roleKey?: string;
      successMessage: string;
    }) => {
      if (!selectedUserId) {
        return;
      }
      try {
        const response = await fetch(
          buildRuntimeScopeUrl(
            `/api/v1/platform/users/${selectedUserId}/workspaces`,
          ),
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              membershipId,
              workspaceId,
              action,
              roleKey,
            }),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || successMessage);
        }
        message.success(successMessage);
        await refreshUserState(selectedUserId, { refreshDetail: true });
      } catch (actionError: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          actionError,
          successMessage,
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    },
    [refreshUserState, selectedUserId],
  );

  const columns: TableColumnsType<PlatformUserRecord> = [
    {
      title: '姓名',
      dataIndex: 'displayName',
      key: 'displayName',
      width: 180,
      render: (_value, record) => (
        <Text strong>{record.displayName || '未命名用户'}</Text>
      ),
    },
    {
      title: '账号',
      key: 'account',
      width: 220,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Text>{formatAccountLabel(record.email, record.id)}</Text>
          <Text type="secondary">{record.email}</Text>
        </Space>
      ),
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      key: 'phone',
      width: 160,
      render: (value?: string | null) => formatPhoneLabel(value),
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
      title: '平台角色',
      key: 'platformRoles',
      width: 220,
      render: (_value, record) => platformRoleTag(record),
    },
    {
      title: '默认工作空间',
      dataIndex: 'defaultWorkspaceName',
      key: 'defaultWorkspaceName',
      width: 200,
      render: (value?: string | null) =>
        value ? (
          <Tag color="gold">{getReferenceDisplayWorkspaceName(value)}</Tag>
        ) : (
          <Text type="secondary">未设置</Text>
        ),
    },
    {
      title: '所属工作空间',
      dataIndex: 'workspaceCount',
      key: 'workspaceCount',
      width: 130,
      render: (value: number) => `${value} 个`,
    },
    {
      title: '操作',
      key: 'actions',
      width: 320,
      render: (_value, record) => {
        const actions: JSX.Element[] = [];

        if (canUpdateUsers) {
          actions.push(
            <Button
              key="edit"
              onClick={() => {
                setEditingUser(record);
                editForm.setFieldsValue({
                  displayName: record.displayName || '',
                });
                setEditModalOpen(true);
              }}
            >
              编辑
            </Button>,
          );
        }

        if (canAssignPlatformRoles) {
          actions.push(
            <Button
              key="roles"
              onClick={() => {
                setRoleUser(record);
                roleForm.setFieldsValue({
                  platformRoleIds: record.platformRoleIds || [],
                });
                setRoleModalOpen(true);
              }}
            >
              调整角色
            </Button>,
          );
        }

        actions.push(
          <Button
            key="workspaces"
            onClick={() => void loadUserDetail(record.id)}
          >
            {canAssignUserWorkspaces ? '管理所属空间' : '查看所属空间'}
          </Button>,
        );

        return <Space wrap>{actions}</Space>;
      },
    },
  ];

  const membershipColumns: TableColumnsType<WorkspaceMembershipView> = [
    {
      title: '工作空间',
      key: 'workspace',
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>
            {getReferenceDisplayWorkspaceName(record.workspace?.name || '—')}
          </Text>
          <Text type="secondary">{record.workspace?.kind || 'regular'}</Text>
        </Space>
      ),
    },
    {
      title: '权限',
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
      width: 320,
      render: (_value, record) => {
        if (!canAssignUserWorkspaces && !canUpdateUsers) {
          return <Text type="secondary">只读</Text>;
        }

        return (
          <Space wrap>
            {canAssignUserWorkspaces ? (
              record.roleKey === 'owner' ? (
                <Button
                  onClick={() =>
                    void handleWorkspaceAction({
                      membershipId: record.id,
                      workspaceId: record.workspaceId,
                      action: 'updateRole',
                      roleKey: 'viewer',
                      successMessage: '已调整为查看者',
                    })
                  }
                >
                  调整为查看者
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    void handleWorkspaceAction({
                      membershipId: record.id,
                      workspaceId: record.workspaceId,
                      action: 'updateRole',
                      roleKey: 'owner',
                      successMessage: '已调整为所有者',
                    })
                  }
                >
                  调整为所有者
                </Button>
              )
            ) : null}
            {detail?.user.defaultWorkspaceId !== record.workspaceId ? (
              canUpdateUsers ? (
                <Button
                  onClick={() =>
                    void patchUser(
                      detail?.user.id || '',
                      { defaultWorkspaceId: record.workspaceId },
                      '默认工作空间已更新',
                    )
                  }
                >
                  设为默认
                </Button>
              ) : null
            ) : (
              <Text type="secondary">当前默认</Text>
            )}
            {canAssignUserWorkspaces ? (
              <Popconfirm
                title="确认移出该工作空间吗？"
                onConfirm={() =>
                  void handleWorkspaceAction({
                    membershipId: record.id,
                    workspaceId: record.workspaceId,
                    action: 'remove',
                    successMessage: '已移出工作空间',
                  })
                }
              >
                <Button danger>移除</Button>
              </Popconfirm>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <ConsoleShellLayout
      title="用户管理"
      eyebrow="Platform Users"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="当前未登录"
          description="请先登录后再查看平台用户目录。"
        />
      ) : !canAccessPage ? (
        <Alert
          className="console-alert"
          type="error"
          showIcon
          message="当前账号没有平台治理权限"
          description="平台用户管理仅对具备平台用户目录权限的角色开放。"
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {error ? <Alert type="warning" showIcon message={error} /> : null}

          <Space
            wrap
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <Input.Search
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索姓名 / 账号 / 默认工作空间"
              style={{ width: 320 }}
            />
            {canCreateUsers ? (
              <Button type="primary" onClick={() => setCreateModalOpen(true)}>
                新增用户
              </Button>
            ) : null}
          </Space>

          <Table
            className="console-table"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={filteredUsers}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: loading ? '加载中…' : '暂无用户数据' }}
            scroll={{ x: 1460 }}
          />
        </Space>
      )}

      <Drawer
        open={Boolean(detail && selectedUserId)}
        width={920}
        title={`${detail?.user.displayName || detail?.user.email || '用户'} · 管理所属空间`}
        onClose={() => {
          setSelectedUserId(null);
          setDetail(null);
          setWorkspaceModalOpen(false);
        }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space
            align="start"
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <Space direction="vertical" size={6}>
              <Text strong>{detail?.user.displayName || '未命名用户'}</Text>
              <Text type="secondary">{detail?.user.email || '—'}</Text>
              <Space wrap>
                {detail?.user ? platformRoleTag(detail.user) : null}
                <Tag color={applicationStatusColor(detail?.user.status || '')}>
                  {STATUS_LABELS[detail?.user.status || ''] ||
                    detail?.user.status ||
                    '—'}
                </Tag>
                <Tag>已关联 {detail?.user.workspaceCount || 0} 个工作空间</Tag>
              </Space>
            </Space>
            <Space direction="vertical" size={6} style={{ minWidth: 280 }}>
              <Text type="secondary">默认工作空间</Text>
              <Select
                value={detail?.user.defaultWorkspaceId || undefined}
                style={{ width: '100%' }}
                placeholder="选择默认工作空间"
                disabled={!canUpdateUsers}
                options={(detail?.memberships || [])
                  .filter((membership) => membership.status === 'active')
                  .map((membership) => ({
                    label: membership.workspace?.name || membership.workspaceId,
                    value: membership.workspaceId,
                  }))}
                allowClear
                onChange={(value) =>
                  void patchUser(
                    detail?.user.id || '',
                    { defaultWorkspaceId: value || null },
                    '默认工作空间已更新',
                  )
                }
              />
            </Space>
          </Space>

          <Alert
            type="info"
            showIcon
            message="这里负责管理该用户所属工作空间"
            description="平台角色请使用列表中的“调整角色”按钮修改；默认工作空间只允许设置为已启用的成员关系。"
          />

          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>所属工作空间</Text>
            {canAssignUserWorkspaces ? (
              <Button
                type="primary"
                onClick={() => {
                  workspaceForm.setFieldsValue({ roleKey: 'viewer' });
                  setWorkspaceModalOpen(true);
                }}
              >
                分配工作空间
              </Button>
            ) : null}
          </Space>

          <Table
            className="console-table"
            rowKey="id"
            loading={detailLoading}
            columns={membershipColumns}
            dataSource={detail?.memberships || []}
            pagination={false}
            locale={{
              emptyText: detailLoading ? '加载中…' : '暂无工作空间关联',
            }}
            scroll={{ x: 980 }}
          />
        </Space>
      </Drawer>

      <Modal
        open={workspaceModalOpen}
        title="分配工作空间"
        destroyOnClose
        onCancel={() => setWorkspaceModalOpen(false)}
        onOk={() => void handleSubmitWorkspace()}
        okText="确认分配"
      >
        <Form form={workspaceForm} layout="vertical">
          <Form.Item
            label="工作空间"
            name="workspaceId"
            rules={[{ required: true, message: '请选择工作空间' }]}
          >
            <Select
              options={(detail?.availableWorkspaces || []).map((workspace) => ({
                label: getReferenceDisplayWorkspaceName(workspace.name),
                value: workspace.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            label="默认权限"
            name="roleKey"
            rules={[{ required: true, message: '请选择默认权限' }]}
          >
            <Select options={WORKSPACE_MEMBER_ROLE_OPTIONS as any} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={createModalOpen}
        title="新增用户"
        destroyOnClose
        confirmLoading={createSubmitting}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
        onOk={() => void handleCreateUser()}
        okText="创建"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            label="姓名"
            name="displayName"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input placeholder="例如：张三" />
          </Form.Item>
          <Form.Item
            label="登录邮箱"
            name="email"
            rules={[
              { required: true, message: '请输入登录邮箱' },
              { type: 'email', message: '请输入有效邮箱地址' },
            ]}
          >
            <Input placeholder="zhangsan@example.com" />
          </Form.Item>
          <Form.Item
            label="初始密码"
            name="password"
            rules={[
              { required: true, message: '请输入初始密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password placeholder="请输入至少 8 位密码" />
          </Form.Item>
          <Form.Item
            label="确认密码"
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={editModalOpen}
        title="编辑用户"
        destroyOnClose
        confirmLoading={editSubmitting}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingUser(null);
          editForm.resetFields();
        }}
        onOk={() => void handleEditUser()}
        okText="保存"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="登录邮箱">
            <Input value={editingUser?.email || ''} disabled />
          </Form.Item>
          <Form.Item
            label="姓名"
            name="displayName"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input placeholder="请输入姓名" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={roleModalOpen}
        title="调整平台角色"
        destroyOnClose
        confirmLoading={roleSubmitting}
        onCancel={() => {
          setRoleModalOpen(false);
          setRoleUser(null);
          roleForm.resetFields();
        }}
        onOk={() => void handleSubmitRole()}
        okText="保存"
      >
        <Form
          form={roleForm}
          layout="vertical"
          initialValues={{ platformRoleIds: [] }}
        >
          <Form.Item label="账号">
            <Input value={roleUser?.email || ''} disabled />
          </Form.Item>
          <Form.Item label="平台角色" name="platformRoleIds">
            <Select
              mode="multiple"
              placeholder="选择平台角色"
              optionFilterProp="label"
              options={platformRoleCatalog
                .filter((role) => role.isActive !== false)
                .map((role) => ({
                  label: role.displayName,
                  value: role.id,
                }))}
            />
          </Form.Item>
          <Text type="secondary">
            平台角色决定用户可见的平台菜单与平台级 API
            capability。分配任一平台角色后即可进入平台治理入口，具体页面仍由对应
            capability 决定。
          </Text>
        </Form>
      </Modal>
    </ConsoleShellLayout>
  );
}
