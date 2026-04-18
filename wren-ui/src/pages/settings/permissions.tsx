import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import {
  WorkspaceAuthorizationExplainResponse,
  WorkspaceGovernanceOverview,
  WorkspacePermissionCatalogItem,
  WorkspaceRoleBindingItem,
  WorkspaceRoleCatalogItem,
  formatDateTime,
  formatUserLabel,
} from '@/components/pages/settings/workspaceGovernanceShared';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';
const { Text } = Typography;

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
};

export default function SettingsPermissionsPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = Boolean(
    authSession.data?.authorization?.actor?.platformRoleKeys?.includes(
      'platform_admin',
    ) ||
      authSession.data?.authorization?.actor?.isPlatformAdmin ||
      authSession.data?.isPlatformAdmin,
  );

  const workspaceOverviewUrl = useMemo(
    () =>
      runtimeScopePage.hasRuntimeScope
        ? buildRuntimeScopeUrl('/api/v1/workspace/current')
        : null,
    [runtimeScopePage.hasRuntimeScope],
  );

  const [workspaceOverview, setWorkspaceOverview] =
    useState<WorkspaceGovernanceOverview | null>(null);
  const [roleCatalog, setRoleCatalog] = useState<WorkspaceRoleCatalogItem[]>(
    [],
  );
  const [roleBindings, setRoleBindings] = useState<WorkspaceRoleBindingItem[]>(
    [],
  );
  const [permissionCatalog, setPermissionCatalog] = useState<
    WorkspacePermissionCatalogItem[]
  >([]);
  const [roleCatalogLoading, setRoleCatalogLoading] = useState(false);
  const [roleDisplayName, setRoleDisplayName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [rolePermissionNames, setRolePermissionNames] = useState<string[]>([]);
  const [roleActionLoading, setRoleActionLoading] = useState<{
    kind: 'create' | 'delete';
    roleId?: string;
  } | null>(null);
  const [bindingPrincipalType, setBindingPrincipalType] = useState<
    'user' | 'group' | 'service_account'
  >('user');
  const [bindingPrincipalId, setBindingPrincipalId] = useState<string | null>(
    null,
  );
  const [bindingRoleId, setBindingRoleId] = useState<string | null>(null);
  const [bindingActionLoading, setBindingActionLoading] = useState<{
    kind: 'create' | 'delete';
    bindingId?: string;
  } | null>(null);
  const [accessReviewTitle, setAccessReviewTitle] = useState('');
  const [accessReviewLoading, setAccessReviewLoading] = useState(false);
  const [reviewActionLoading, setReviewActionLoading] = useState<{
    reviewId: string;
    itemId: string;
    decision: 'keep' | 'remove';
  } | null>(null);
  const [breakGlassUserId, setBreakGlassUserId] = useState<string | null>(null);
  const [breakGlassRoleKey, setBreakGlassRoleKey] = useState('owner');
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [breakGlassDurationMinutes, setBreakGlassDurationMinutes] =
    useState('60');
  const [breakGlassLoading, setBreakGlassLoading] = useState(false);
  const [impersonationTargetUserId, setImpersonationTargetUserId] = useState<
    string | null
  >(null);
  const [impersonationReason, setImpersonationReason] = useState('');
  const [impersonationLoading, setImpersonationLoading] = useState(false);
  const [explainResult, setExplainResult] =
    useState<WorkspaceAuthorizationExplainResponse | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainPrincipalType, setExplainPrincipalType] = useState<
    'user' | 'group' | 'service_account'
  >('user');
  const [explainPrincipalId, setExplainPrincipalId] = useState<string | null>(
    null,
  );
  const [explainAction, setExplainAction] = useState('');
  const [explainResourceType, setExplainResourceType] = useState('workspace');
  const [explainResourceId, setExplainResourceId] = useState('');
  const [explainResourceAttributes, setExplainResourceAttributes] =
    useState('{}');

  const loadWorkspaceOverview = useCallback(async () => {
    if (!workspaceOverviewUrl || !authSession.authenticated) {
      return;
    }

    try {
      const response = await fetch(workspaceOverviewUrl, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '加载权限管理失败');
      }
      setWorkspaceOverview(payload as WorkspaceGovernanceOverview);
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载权限管理失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
    }
  }, [authSession.authenticated, workspaceOverviewUrl]);

  const loadRoleCatalog = useCallback(async () => {
    if (!workspaceOverviewUrl || !authSession.authenticated) {
      return;
    }

    try {
      setRoleCatalogLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/roles'),
        {
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) {
          setRoleCatalog([]);
          setRoleBindings([]);
          setPermissionCatalog([]);
          return;
        }
        throw new Error(payload.error || '加载角色目录失败');
      }

      setRoleCatalog(Array.isArray(payload.roles) ? payload.roles : []);
      setRoleBindings(Array.isArray(payload.bindings) ? payload.bindings : []);
      setPermissionCatalog(
        Array.isArray(payload.permissionCatalog)
          ? payload.permissionCatalog
          : [],
      );
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载角色目录失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setRoleCatalogLoading(false);
    }
  }, [authSession.authenticated, workspaceOverviewUrl]);

  useEffect(() => {
    void loadWorkspaceOverview();
  }, [loadWorkspaceOverview]);

  useEffect(() => {
    void loadRoleCatalog();
  }, [loadRoleCatalog]);

  const permissionActions = workspaceOverview?.permissions?.actions || {};
  const canReadRoles = Boolean(permissionActions['role.read']);
  const canManageRoles = Boolean(permissionActions['role.manage']);
  const canManageControls = Boolean(
    permissionActions['access_review.manage'] ||
      permissionActions['break_glass.manage'] ||
      permissionActions['impersonation.start'],
  );
  const ownerCandidateOptions = useMemo(
    () =>
      (workspaceOverview?.ownerCandidates || []).map((candidate) => ({
        label: formatUserLabel(
          candidate.displayName,
          candidate.email,
          candidate.id,
        ),
        value: candidate.id,
      })),
    [workspaceOverview?.ownerCandidates],
  );
  const breakGlassTargetOptions = ownerCandidateOptions;
  const principalOptionsByType = useMemo(() => {
    const userOptions = (workspaceOverview?.members || []).map((member) => ({
      label: formatUserLabel(
        member.user?.displayName,
        member.user?.email,
        member.userId,
      ),
      value: member.userId,
    }));
    const groupOptions = (workspaceOverview?.directoryGroups || []).map(
      (group) => ({
        label: group.displayName,
        value: group.id,
      }),
    );
    const serviceAccountOptions = (
      workspaceOverview?.serviceAccounts || []
    ).map((account) => ({
      label: `${account.name} · ${account.roleKey}`,
      value: account.id,
    }));

    return {
      user: userOptions,
      group: groupOptions,
      service_account: serviceAccountOptions,
    };
  }, [
    workspaceOverview?.members,
    workspaceOverview?.directoryGroups,
    workspaceOverview?.serviceAccounts,
  ]);

  const handleCreateAccessReview = async () => {
    try {
      setAccessReviewLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/access-reviews'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title:
              accessReviewTitle.trim() ||
              `${workspaceOverview?.workspace?.name || 'Workspace'} Access Review`,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '发起访问复核失败');
      }

      message.success('访问复核已发起');
      setAccessReviewTitle('');
      await loadWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '发起访问复核失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setAccessReviewLoading(false);
    }
  };

  const handleReviewAccessItem = async (
    reviewId: string,
    itemId: string,
    decision: 'keep' | 'remove',
  ) => {
    try {
      setReviewActionLoading({ reviewId, itemId, decision });
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/workspace/access-reviews/${reviewId}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ itemId, decision }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '更新访问复核失败');
      }

      message.success(
        decision === 'keep' ? '已保留访问权限' : '已移除访问权限',
      );
      await loadWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '更新访问复核失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setReviewActionLoading(null);
    }
  };

  const handleCreateBreakGlassGrant = async () => {
    if (!breakGlassReason.trim()) {
      message.warning('请输入 break-glass 原因');
      return;
    }

    try {
      setBreakGlassLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/break-glass'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            userId: breakGlassUserId,
            roleKey: breakGlassRoleKey,
            durationMinutes: Number.parseInt(
              breakGlassDurationMinutes || '60',
              10,
            ),
            reason: breakGlassReason.trim(),
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建 break-glass 授权失败');
      }

      message.success('break-glass 授权已创建');
      setBreakGlassUserId(null);
      setBreakGlassRoleKey('owner');
      setBreakGlassReason('');
      setBreakGlassDurationMinutes('60');
      await loadWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建 break-glass 授权失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setBreakGlassLoading(false);
    }
  };

  const handleRevokeBreakGlassGrant = async (grantId: string) => {
    try {
      setBreakGlassLoading(true);
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/workspace/break-glass/${grantId}`),
        {
          method: 'PATCH',
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '撤销 break-glass 授权失败');
      }

      message.success('break-glass 授权已撤销');
      await loadWorkspaceOverview();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '撤销 break-glass 授权失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setBreakGlassLoading(false);
    }
  };

  const handleStartImpersonation = async () => {
    if (!impersonationTargetUserId) {
      message.warning('请选择目标用户');
      return;
    }
    if (!impersonationReason.trim()) {
      message.warning('请输入代理登录原因');
      return;
    }

    try {
      setImpersonationLoading(true);
      const response = await fetch('/api/auth/impersonation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targetUserId: impersonationTargetUserId,
          targetWorkspaceId: workspaceOverview?.workspace?.id,
          reason: impersonationReason.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '发起代理登录失败');
      }

      message.success('已切换到代理登录会话');
      window.location.assign(
        buildRuntimeScopeUrl(Path.Home, {}, payload.runtimeSelector),
      );
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '发起代理登录失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setImpersonationLoading(false);
    }
  };

  const handleCreateCustomRole = async () => {
    const displayName = roleDisplayName.trim();
    if (!displayName) {
      message.warning('请输入角色名称');
      return;
    }
    try {
      setRoleActionLoading({ kind: 'create' });
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/roles'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            displayName,
            description: roleDescription.trim() || null,
            permissionNames: rolePermissionNames,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建自定义角色失败');
      }

      message.success('自定义角色已创建');
      setRoleDisplayName('');
      setRoleDescription('');
      setRolePermissionNames([]);
      await loadRoleCatalog();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建自定义角色失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setRoleActionLoading(null);
    }
  };

  const handleDeleteCustomRole = async (roleId: string) => {
    try {
      setRoleActionLoading({ kind: 'delete', roleId });
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/workspace/roles/${roleId}`),
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '删除自定义角色失败');
      }

      message.success('自定义角色已删除');
      await loadRoleCatalog();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '删除自定义角色失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setRoleActionLoading(null);
    }
  };

  const handleCreateRoleBinding = async () => {
    if (!bindingPrincipalId || !bindingRoleId) {
      message.warning('请选择绑定主体和角色');
      return;
    }
    try {
      setBindingActionLoading({ kind: 'create' });
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/role-bindings'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            principalType: bindingPrincipalType,
            principalId: bindingPrincipalId,
            roleId: bindingRoleId,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '创建角色绑定失败');
      }

      message.success('角色绑定已创建');
      setBindingPrincipalId(null);
      setBindingRoleId(null);
      await loadRoleCatalog();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '创建角色绑定失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setBindingActionLoading(null);
    }
  };

  const handleDeleteRoleBinding = async (bindingId: string) => {
    try {
      setBindingActionLoading({ kind: 'delete', bindingId });
      const response = await fetch(
        buildRuntimeScopeUrl(`/api/v1/workspace/role-bindings/${bindingId}`),
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '删除角色绑定失败');
      }

      message.success('角色绑定已删除');
      await loadRoleCatalog();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '删除角色绑定失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setBindingActionLoading(null);
    }
  };

  const handleRunAuthorizationExplain = async () => {
    if (!explainPrincipalId) {
      message.warning('请选择要解释的主体');
      return;
    }
    try {
      setExplainLoading(true);
      const raw = explainResourceAttributes.trim();
      let resourceAttributes: Record<string, any> | undefined;
      if (raw && raw !== '{}') {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          resourceAttributes = parsed as Record<string, any>;
        }
      }
      const response = await fetch(
        buildRuntimeScopeUrl('/api/v1/workspace/authorization/explain'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            principalType: explainPrincipalType,
            principalId: explainPrincipalId,
            action: explainAction.trim() || undefined,
            resourceType: explainResourceType.trim() || 'workspace',
            resourceId:
              explainResourceId.trim() ||
              workspaceOverview?.workspace?.id ||
              '',
            resourceAttributes,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '权限解释失败');
      }

      setExplainResult(payload as WorkspaceAuthorizationExplainResponse);
      message.success('权限解释完成');
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(error, '权限解释失败');
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setExplainLoading(false);
    }
  };

  const activeBreakGlassCount = (
    workspaceOverview?.breakGlassGrants || []
  ).filter((grant) => !grant.revokedAt && grant.status === 'active').length;

  return (
    <ConsoleShellLayout
      title="权限管理"
      description="集中管理角色目录、绑定关系、授权解释与高风险权限流程。"
      eyebrow="Permissions"
      loading={runtimeScopePage.guarding || authSession.loading}
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsPermissions',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: showPlatformManagement,
      })}
      hideHistorySection
      hideHeader
      contentBorderless
      sidebarBackAction={{
        label: '返回主菜单',
        onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
      }}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="当前未登录"
          description="请先登录后再查看权限管理。"
        />
      ) : (
        <div className="console-grid">
          <section className="console-panel" style={{ gridColumn: 'span 6' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">角色目录</div>
                <div className="console-panel-subtitle">
                  角色 {roleCatalog.length} · 绑定 {roleBindings.length}
                </div>
              </div>
            </div>
            {!canReadRoles ? (
              <Alert
                type="info"
                showIcon
                message="当前为只读提示"
                description="你没有 role.read 权限，暂时无法查看角色目录。"
              />
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {canManageRoles ? (
                  <>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Input
                        placeholder="角色显示名（例如：数据审阅员）"
                        value={roleDisplayName}
                        onChange={(event) =>
                          setRoleDisplayName(event.target.value)
                        }
                      />
                      <Button
                        type="primary"
                        loading={roleActionLoading?.kind === 'create'}
                        onClick={() => void handleCreateCustomRole()}
                      >
                        创建角色
                      </Button>
                    </div>
                    <Input
                      placeholder="角色描述（可选）"
                      value={roleDescription}
                      onChange={(event) =>
                        setRoleDescription(event.target.value)
                      }
                    />
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="角色权限（仅可分配动作）"
                      value={rolePermissionNames}
                      onChange={(value) => setRolePermissionNames(value)}
                      options={permissionCatalog
                        .filter((permission) => permission.assignable)
                        .map((permission) => ({
                          label: `${permission.name}${permission.description ? ` · ${permission.description}` : ''}`,
                          value: permission.name,
                        }))}
                    />
                  </>
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    message="当前为只读视图"
                    description="你可以查看角色目录，但创建/删除角色需要 role.manage 权限。"
                  />
                )}
                <Table
                  className="console-table"
                  rowKey="id"
                  size="small"
                  loading={roleCatalogLoading}
                  pagination={{
                    pageSize: 8,
                    hideOnSinglePage: true,
                    size: 'small',
                  }}
                  locale={{ emptyText: '暂无角色目录数据' }}
                  dataSource={roleCatalog}
                  columns={[
                    {
                      title: '角色',
                      key: 'role',
                      render: (_value, record: WorkspaceRoleCatalogItem) => (
                        <Space direction="vertical" size={0}>
                          <Text strong>{record.displayName}</Text>
                          <Text type="secondary">{record.name}</Text>
                        </Space>
                      ),
                    },
                    {
                      title: '权限',
                      dataIndex: 'permissionNames',
                      render: (value: string[]) =>
                        value?.length ? value.join('、') : '—',
                    },
                    { title: '绑定数', dataIndex: 'bindingCount', width: 90 },
                    {
                      title: '类型',
                      dataIndex: 'isSystem',
                      width: 90,
                      render: (value: boolean) => (
                        <Tag color={value ? 'blue' : 'purple'}>
                          {value ? '系统' : '自定义'}
                        </Tag>
                      ),
                    },
                    ...(canManageRoles
                      ? [
                          {
                            title: '操作',
                            key: 'actions',
                            width: 100,
                            render: (
                              _value: unknown,
                              record: WorkspaceRoleCatalogItem,
                            ) =>
                              record.isSystem ? null : (
                                <Button
                                  size="small"
                                  danger
                                  loading={
                                    roleActionLoading?.kind === 'delete' &&
                                    roleActionLoading.roleId === record.id
                                  }
                                  onClick={() =>
                                    void handleDeleteCustomRole(record.id)
                                  }
                                >
                                  删除
                                </Button>
                              ),
                          },
                        ]
                      : []),
                  ]}
                />
              </Space>
            )}
          </section>

          <section className="console-panel" style={{ gridColumn: 'span 6' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">角色绑定</div>
                <div className="console-panel-subtitle">
                  管理 user / group / service_account 到自定义角色的绑定。
                </div>
              </div>
            </div>
            {!canReadRoles ? (
              <Alert
                type="info"
                showIcon
                message="当前为只读提示"
                description="你没有 role.read 权限，暂时无法查看角色绑定。"
              />
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {canManageRoles ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        '150px minmax(0,1fr) minmax(0,1fr) auto',
                      gap: 8,
                    }}
                  >
                    <Select
                      value={bindingPrincipalType}
                      onChange={(value) => {
                        setBindingPrincipalType(value);
                        setBindingPrincipalId(null);
                      }}
                      options={[
                        { label: '用户', value: 'user' },
                        { label: '目录组', value: 'group' },
                        { label: '服务账号', value: 'service_account' },
                      ]}
                    />
                    <Select
                      allowClear
                      showSearch
                      value={bindingPrincipalId || undefined}
                      placeholder="绑定主体"
                      optionFilterProp="label"
                      options={principalOptionsByType[bindingPrincipalType]}
                      onChange={(value) => setBindingPrincipalId(value || null)}
                    />
                    <Select
                      allowClear
                      value={bindingRoleId || undefined}
                      placeholder="绑定角色（仅自定义角色）"
                      options={roleCatalog
                        .filter((role) => !role.isSystem)
                        .map((role) => ({
                          label: role.displayName,
                          value: role.id,
                        }))}
                      onChange={(value) => setBindingRoleId(value || null)}
                    />
                    <Button
                      type="primary"
                      loading={bindingActionLoading?.kind === 'create'}
                      onClick={() => void handleCreateRoleBinding()}
                    >
                      新建绑定
                    </Button>
                  </div>
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    message="当前为只读视图"
                    description="你可以查看角色绑定，但增删绑定需要 role.manage 权限。"
                  />
                )}
                <Table
                  className="console-table"
                  rowKey="id"
                  size="small"
                  loading={roleCatalogLoading}
                  pagination={{
                    pageSize: 8,
                    hideOnSinglePage: true,
                    size: 'small',
                  }}
                  locale={{ emptyText: '暂无角色绑定数据' }}
                  dataSource={roleBindings}
                  columns={[
                    {
                      title: '主体类型',
                      dataIndex: 'principalType',
                      width: 110,
                    },
                    { title: '主体', dataIndex: 'principalLabel' },
                    { title: '角色', dataIndex: 'roleDisplayName' },
                    {
                      title: '创建时间',
                      dataIndex: 'createdAt',
                      width: 140,
                      render: (value: string | null | undefined) =>
                        formatDateTime(value),
                    },
                    ...(canManageRoles
                      ? [
                          {
                            title: '操作',
                            key: 'actions',
                            width: 90,
                            render: (
                              _value: unknown,
                              record: WorkspaceRoleBindingItem,
                            ) => (
                              <Button
                                size="small"
                                danger
                                loading={
                                  bindingActionLoading?.kind === 'delete' &&
                                  bindingActionLoading.bindingId === record.id
                                }
                                onClick={() =>
                                  void handleDeleteRoleBinding(record.id)
                                }
                              >
                                删除
                              </Button>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </Space>
            )}
          </section>

          <section className="console-panel" style={{ gridColumn: 'span 6' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">
                  权限 Explain / Simulate
                </div>
                <div className="console-panel-subtitle">
                  基于主体、动作和资源，解释当前授权结果（role.read）。
                </div>
              </div>
            </div>
            {!canReadRoles ? (
              <Alert
                type="info"
                showIcon
                message="当前为只读提示"
                description="你没有 role.read 权限，暂时无法执行权限解释。"
              />
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '150px minmax(0,1fr) minmax(0,1fr)',
                    gap: 8,
                  }}
                >
                  <Select
                    value={explainPrincipalType}
                    onChange={(value) => {
                      setExplainPrincipalType(value);
                      setExplainPrincipalId(null);
                    }}
                    options={[
                      { label: '用户', value: 'user' },
                      { label: '目录组', value: 'group' },
                      { label: '服务账号', value: 'service_account' },
                    ]}
                  />
                  <Select
                    allowClear
                    showSearch
                    placeholder="解释主体"
                    optionFilterProp="label"
                    value={explainPrincipalId || undefined}
                    options={principalOptionsByType[explainPrincipalType]}
                    onChange={(value) => setExplainPrincipalId(value || null)}
                  />
                  <Input
                    placeholder="Action（可选，例如 connector.create）"
                    value={explainAction}
                    onChange={(event) => setExplainAction(event.target.value)}
                  />
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px minmax(0,1fr) auto',
                    gap: 8,
                  }}
                >
                  <Input
                    placeholder="resourceType"
                    value={explainResourceType}
                    onChange={(event) =>
                      setExplainResourceType(event.target.value)
                    }
                  />
                  <Input
                    placeholder="resourceId（可选，默认当前 workspace）"
                    value={explainResourceId}
                    onChange={(event) =>
                      setExplainResourceId(event.target.value)
                    }
                  />
                  <Button
                    type="primary"
                    loading={explainLoading}
                    onClick={() => void handleRunAuthorizationExplain()}
                  >
                    执行 Explain
                  </Button>
                </div>
                <Input.TextArea
                  rows={3}
                  value={explainResourceAttributes}
                  onChange={(event) =>
                    setExplainResourceAttributes(event.target.value)
                  }
                  placeholder="resourceAttributes JSON（可选）"
                />
                {explainResult ? (
                  <Alert
                    type={
                      explainResult.decision?.allowed ? 'success' : 'warning'
                    }
                    showIcon
                    message={
                      explainResult.decision
                        ? `决策：${explainResult.decision.allowed ? 'ALLOW' : 'DENY'}`
                        : '仅返回主体授权画像（未带 action）'
                    }
                    description={
                      <Space direction="vertical" size={4}>
                        {explainResult.decision?.reason ? (
                          <Text type="secondary">
                            原因：{explainResult.decision.reason}
                          </Text>
                        ) : null}
                        <Text type="secondary">
                          Direct bindings：{explainResult.directBindings.length}{' '}
                          · Group bindings：{explainResult.groupBindings.length}{' '}
                          · Platform bindings：
                          {explainResult.platformBindings.length}
                        </Text>
                        <Text type="secondary">
                          Granted actions：
                          {explainResult.grantedActions.join('、') || '—'}
                        </Text>
                      </Space>
                    }
                  />
                ) : null}
              </Space>
            )}
          </section>

          <section className="console-panel" style={{ gridColumn: 'span 6' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">
                  <SafetyCertificateOutlined style={{ marginRight: 8 }} />
                  访问复核与高风险流程
                </div>
                <div className="console-panel-subtitle">
                  访问复核 {workspaceOverview?.accessReviews?.length || 0} ·
                  Break-glass 生效中 {activeBreakGlassCount}
                </div>
              </div>
            </div>
            {!canManageControls ? (
              <Alert
                type="info"
                showIcon
                message="当前为只读视图"
                description="你可以查看 access review、break-glass 与代理登录状态，但发起复核、紧急授权或代理登录仍需要具备对应治理权限。"
              />
            ) : null}
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {canManageControls ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) auto',
                    gap: 10,
                  }}
                >
                  <Input
                    placeholder="复核标题，例如 Q2 成员权限复核"
                    value={accessReviewTitle}
                    onChange={(event) =>
                      setAccessReviewTitle(event.target.value)
                    }
                  />
                  <Button
                    type="primary"
                    loading={accessReviewLoading}
                    onClick={() => void handleCreateAccessReview()}
                  >
                    发起复核
                  </Button>
                </div>
              ) : null}
              {(workspaceOverview?.accessReviews || []).length === 0 ? (
                <Text type="secondary">当前还没有访问复核记录。</Text>
              ) : (
                (workspaceOverview?.accessReviews || [])
                  .slice(0, 2)
                  .map((review) => (
                    <div
                      key={review.id}
                      style={{
                        border: '1px solid var(--nova-outline-soft)',
                        borderRadius: 16,
                        padding: 12,
                      }}
                    >
                      <Space
                        align="center"
                        style={{
                          width: '100%',
                          justifyContent: 'space-between',
                        }}
                        wrap
                      >
                        <Space wrap>
                          <Text strong>{review.title}</Text>
                          <Tag
                            color={
                              review.status === 'completed' ? 'green' : 'gold'
                            }
                          >
                            {review.status === 'completed'
                              ? '已完成'
                              : '进行中'}
                          </Tag>
                        </Space>
                        <Text type="secondary">
                          {formatDateTime(review.createdAt)}
                        </Text>
                      </Space>
                      <Space
                        direction="vertical"
                        size={8}
                        style={{ width: '100%', marginTop: 12 }}
                      >
                        {(review.items || []).slice(0, 3).map((item) => {
                          const member = (
                            workspaceOverview?.members || []
                          ).find(
                            (candidate) => candidate.userId === item.userId,
                          );
                          const busy =
                            reviewActionLoading?.reviewId === review.id &&
                            reviewActionLoading?.itemId === item.id;
                          return (
                            <div key={item.id}>
                              <Space wrap>
                                <Text strong>
                                  {formatUserLabel(
                                    member?.user?.displayName,
                                    member?.user?.email,
                                    item.userId || item.id,
                                  )}
                                </Text>
                                <Tag color="blue">
                                  {ROLE_LABELS[item.roleKey || 'member'] ||
                                    item.roleKey ||
                                    'member'}
                                </Tag>
                                <Tag
                                  color={
                                    item.decision === 'remove'
                                      ? 'red'
                                      : item.decision === 'keep'
                                        ? 'green'
                                        : 'gold'
                                  }
                                >
                                  {item.decision === 'remove'
                                    ? '移除'
                                    : item.decision === 'keep'
                                      ? '保留'
                                      : '待处理'}
                                </Tag>
                              </Space>
                              {canManageControls &&
                              item.status !== 'reviewed' ? (
                                <Space wrap style={{ marginTop: 8 }}>
                                  <Button
                                    size="small"
                                    type="primary"
                                    loading={
                                      busy &&
                                      reviewActionLoading?.decision === 'keep'
                                    }
                                    onClick={() =>
                                      void handleReviewAccessItem(
                                        review.id,
                                        item.id,
                                        'keep',
                                      )
                                    }
                                  >
                                    保留
                                  </Button>
                                  <Button
                                    size="small"
                                    danger
                                    loading={
                                      busy &&
                                      reviewActionLoading?.decision === 'remove'
                                    }
                                    onClick={() =>
                                      void handleReviewAccessItem(
                                        review.id,
                                        item.id,
                                        'remove',
                                      )
                                    }
                                  >
                                    移除
                                  </Button>
                                </Space>
                              ) : null}
                            </div>
                          );
                        })}
                      </Space>
                    </div>
                  ))
              )}
              {canManageControls ? (
                <>
                  <Alert
                    type="warning"
                    showIcon
                    message="Break-glass 仅用于紧急场景"
                    description="建议优先使用目录组、工作空间成员或代理登录；Break-glass 应设置明确原因与较短时效。"
                  />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0,1.4fr) 120px 120px',
                      gap: 10,
                    }}
                  >
                    <Select
                      allowClear
                      showSearch
                      value={breakGlassUserId || undefined}
                      placeholder="目标用户（留空则授权给当前平台管理员）"
                      options={breakGlassTargetOptions}
                      optionFilterProp="label"
                      onChange={(value) => setBreakGlassUserId(value)}
                    />
                    <Select
                      value={breakGlassRoleKey}
                      options={[
                        { label: '所有者', value: 'owner' },
                        { label: '管理员', value: 'admin' },
                        { label: '成员', value: 'member' },
                      ]}
                      onChange={setBreakGlassRoleKey}
                    />
                    <Select
                      value={breakGlassDurationMinutes}
                      options={[
                        { label: '15 分钟', value: '15' },
                        { label: '30 分钟', value: '30' },
                        { label: '60 分钟', value: '60' },
                        { label: '240 分钟', value: '240' },
                      ]}
                      onChange={setBreakGlassDurationMinutes}
                    />
                  </div>
                  <div
                    style={{
                      width: '100%',
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0,1fr) auto',
                      gap: 10,
                    }}
                  >
                    <Input
                      placeholder="输入紧急授权原因，例如排查客户 SSO 故障"
                      value={breakGlassReason}
                      onChange={(event) =>
                        setBreakGlassReason(event.target.value)
                      }
                    />
                    <Button
                      type="primary"
                      loading={breakGlassLoading}
                      onClick={() => void handleCreateBreakGlassGrant()}
                    >
                      创建紧急授权
                    </Button>
                  </div>
                  {(workspaceOverview?.breakGlassGrants || [])
                    .slice(0, 3)
                    .map((grant) => (
                      <Space
                        key={grant.id}
                        wrap
                        style={{
                          width: '100%',
                          justifyContent: 'space-between',
                          border: '1px solid var(--nova-outline-soft)',
                          borderRadius: 14,
                          padding: 12,
                        }}
                      >
                        <Space direction="vertical" size={0}>
                          <Text strong>
                            {formatUserLabel(
                              grant.user?.displayName,
                              grant.user?.email,
                              grant.userId,
                            )}
                          </Text>
                          <Text type="secondary">
                            {grant.reason || '—'} · 到期{' '}
                            {formatDateTime(grant.expiresAt)}
                          </Text>
                        </Space>
                        {!grant.revokedAt && grant.status === 'active' ? (
                          <Button
                            size="small"
                            danger
                            loading={breakGlassLoading}
                            onClick={() =>
                              void handleRevokeBreakGlassGrant(grant.id)
                            }
                          >
                            撤销
                          </Button>
                        ) : (
                          <Tag>{grant.status}</Tag>
                        )}
                      </Space>
                    ))}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) auto',
                      gap: 10,
                    }}
                  >
                    <Select
                      showSearch
                      value={impersonationTargetUserId || undefined}
                      placeholder="选择代理目标用户"
                      options={ownerCandidateOptions}
                      optionFilterProp="label"
                      onChange={(value) => setImpersonationTargetUserId(value)}
                    />
                    <Input
                      placeholder="输入代理原因，例如排查成员工单"
                      value={impersonationReason}
                      onChange={(event) =>
                        setImpersonationReason(event.target.value)
                      }
                    />
                    <Button
                      type="primary"
                      loading={impersonationLoading}
                      onClick={() => void handleStartImpersonation()}
                    >
                      开始代理登录
                    </Button>
                  </div>
                </>
              ) : null}
              <Text>
                代理登录：
                {workspaceOverview?.impersonation?.active
                  ? `进行中${workspaceOverview?.impersonation?.reason ? ` · ${workspaceOverview.impersonation.reason}` : ''}`
                  : '当前无代理会话'}
              </Text>
            </Space>
          </section>
        </div>
      )}
    </ConsoleShellLayout>
  );
}
