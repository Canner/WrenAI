import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Skeleton,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
  type MenuProps,
} from 'antd';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import {
  resolvePlatformConsoleCapabilities,
  resolvePlatformManagementFromAuthSession,
} from '@/features/settings/settingsPageCapabilities';
import PermissionsRoleCatalogUnsavedModal from '@/features/settings/permissions/PermissionsRoleCatalogUnsavedModal';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import {
  EMPTY_ROLE_DRAFT,
  EMPTY_ROLE_ID,
  PLATFORM_PERMISSION_MODULES,
  buildRoleDraftFromRole,
  buildRolePayload,
  getActionDescriptor,
  getModuleKey,
  getPermissionDescription,
  getPermissionHeadline,
  getPermissionResourceKey,
  getResourceLabel,
  isDraftEqual,
  matchesRoleKeyword,
  normalizePermissionNames,
  normalizeRoleNameInput,
  type PermissionGroup,
  type PermissionModuleSummary,
  type PlatformPermissionCatalogItem,
  type PlatformPermissionModuleKey,
  type PlatformRoleCatalogItem,
  type RoleDraft,
} from './platformPermissionsMeta';

const { Paragraph, Text } = Typography;
const { TabPane } = Tabs;

type PermissionsPayload = {
  roles: PlatformRoleCatalogItem[];
  permissionCatalog: PlatformPermissionCatalogItem[];
  actor?: {
    principalId: string;
    platformRoleKeys?: string[];
    isPlatformAdmin?: boolean;
  } | null;
};

type PendingAction = { type: 'create' } | { type: 'select'; roleId: string };

const READONLY_FIELD_STYLE = {
  minWidth: 180,
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
  paddingInline: 11,
  borderRadius: 6,
  border: '1px solid var(--ant-color-border-secondary)',
  background: 'var(--ant-color-fill-quaternary)',
} as const;

const PANEL_BODY_STYLE = {
  padding: '12px 12px 8px',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
} as const;

const FILTER_BAR_STYLE = {
  marginBottom: 8,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
  padding: '6px 8px',
  border: '1px solid var(--ant-color-border-secondary)',
  borderRadius: 8,
  background: 'var(--ant-color-fill-quaternary)',
} as const;

const FOOTER_BAR_STYLE = {
  marginTop: 'auto',
  borderTop: '1px solid var(--ant-color-border-secondary)',
  paddingTop: 12,
  paddingInline: 2,
  paddingBottom: 0,
  position: 'sticky',
  bottom: 0,
  background: 'var(--ant-color-bg-container)',
  boxShadow: '0 -8px 20px rgba(15, 23, 42, 0.04)',
  zIndex: 1,
} as const;

const ACTION_LABEL_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 22,
  paddingInline: 8,
  borderRadius: 999,
  color: 'var(--ant-color-primary)',
  background: 'var(--ant-color-primary-bg)',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
} as const;

export default function ManagePlatformPermissionsPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const platformCapabilities = resolvePlatformConsoleCapabilities(
    authSession.data,
  );
  const canAccessPage = platformCapabilities.canReadRoles;
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsPermissions',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<PlatformRoleCatalogItem[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<
    PlatformPermissionCatalogItem[]
  >([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleKeyword, setRoleKeyword] = useState('');
  const [permissionKeyword, setPermissionKeyword] = useState('');
  const [onlyShowSelected, setOnlyShowSelected] = useState(false);
  const [activeModuleKey, setActiveModuleKey] =
    useState<PlatformPermissionModuleKey>('workspace');
  const [draft, setDraft] = useState<RoleDraft>(EMPTY_ROLE_DRAFT);
  const [actionLoading, setActionLoading] = useState<{
    kind: 'create' | 'update' | 'delete';
    roleId?: string;
  } | null>(null);
  const [unsavedModalOpen, setUnsavedModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );

  const loadPermissions = useCallback(
    async (preferredRoleId?: string | null) => {
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
          buildRuntimeScopeUrl('/api/v1/platform/permissions'),
          {
            credentials: 'include',
          },
        );
        const payload = (await response
          .json()
          .catch(() => ({}))) as PermissionsPayload & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || '加载平台权限失败');
        }

        const nextRoles = payload.roles || [];
        setRoles(nextRoles);
        setPermissionCatalog(payload.permissionCatalog || []);
        setSelectedRoleId((current) => {
          if (
            preferredRoleId &&
            nextRoles.some((role) => role.id === preferredRoleId)
          ) {
            return preferredRoleId;
          }
          if (current === EMPTY_ROLE_ID) {
            return current;
          }
          if (current && nextRoles.some((role) => role.id === current)) {
            return current;
          }
          return nextRoles[0]?.id || null;
        });
      } catch (loadError: any) {
        setError(loadError?.message || '加载平台权限失败');
      } finally {
        setLoading(false);
      }
    },
    [
      authSession.authenticated,
      canAccessPage,
      runtimeScopePage.hasRuntimeScope,
    ],
  );

  useEffect(() => {
    void loadPermissions();
  }, [loadPermissions]);

  useEffect(() => {
    if (selectedRoleId === EMPTY_ROLE_ID) {
      return;
    }
    if (!roles.length) {
      setSelectedRoleId(null);
      setDraft(EMPTY_ROLE_DRAFT);
      return;
    }
    if (!selectedRoleId || !roles.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(roles[0].id);
    }
  }, [roles, selectedRoleId]);

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) || null,
    [roles, selectedRoleId],
  );

  useEffect(() => {
    if (selectedRoleId === EMPTY_ROLE_ID) {
      return;
    }
    if (selectedRole) {
      setDraft(buildRoleDraftFromRole(selectedRole));
    }
  }, [selectedRole, selectedRoleId]);

  const visibleRoles = useMemo(() => {
    const keyword = roleKeyword.trim().toLowerCase();
    return roles.filter((role) => matchesRoleKeyword(role, keyword));
  }, [roleKeyword, roles]);

  const selectedPermissionSet = useMemo(
    () => new Set(draft.permissionNames || []),
    [draft.permissionNames],
  );

  const moduleSummaries = useMemo<PermissionModuleSummary[]>(() => {
    const keyword = permissionKeyword.trim().toLowerCase();
    return PLATFORM_PERMISSION_MODULES.map((module) => {
      const items = permissionCatalog.filter((permission) => {
        if (getModuleKey(permission.name) !== module.key) {
          return false;
        }
        if (onlyShowSelected && !selectedPermissionSet.has(permission.name)) {
          return false;
        }
        if (!keyword) {
          return true;
        }
        const source = [permission.name, permission.description || '']
          .join(' ')
          .toLowerCase();
        return source.includes(keyword);
      });

      return {
        ...module,
        items,
        selectedCount: items.filter((permission) =>
          selectedPermissionSet.has(permission.name),
        ).length,
      };
    });
  }, [
    onlyShowSelected,
    permissionCatalog,
    permissionKeyword,
    selectedPermissionSet,
  ]);

  useEffect(() => {
    if (!moduleSummaries.some((module) => module.key === activeModuleKey)) {
      setActiveModuleKey(moduleSummaries[0]?.key || 'workspace');
    }
  }, [activeModuleKey, moduleSummaries]);

  const activeModule =
    moduleSummaries.find((module) => module.key === activeModuleKey) ||
    moduleSummaries[0] ||
    null;

  const permissionGroups = useMemo<PermissionGroup[]>(() => {
    if (!activeModule) {
      return [];
    }

    const grouped = activeModule.items.reduce<
      Record<string, PlatformPermissionCatalogItem[]>
    >((acc, permission) => {
      const resourceKey = getPermissionResourceKey(permission.name);
      acc[resourceKey] = acc[resourceKey] || [];
      acc[resourceKey].push(permission);
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([key, items]) => ({
        key,
        label: getResourceLabel(key),
        items: items.sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [activeModule]);

  const activeModulePermissionNames = useMemo(
    () => (activeModule?.items || []).map((permission) => permission.name),
    [activeModule],
  );

  const isCreateMode = selectedRoleId === EMPTY_ROLE_ID;
  const isSystemRole = Boolean(selectedRole?.isSystem);
  const canCreateRoles = platformCapabilities.canCreateRoles;
  const canUpdateRoles = platformCapabilities.canUpdateRoles;
  const canSubmitRole = isCreateMode ? canCreateRoles : canUpdateRoles;
  const metadataReadOnly = isSystemRole || !canSubmitRole;
  const baselineDraft = selectedRole
    ? buildRoleDraftFromRole(selectedRole)
    : EMPTY_ROLE_DRAFT;
  const isDirty = isCreateMode
    ? !isDraftEqual(draft, EMPTY_ROLE_DRAFT)
    : selectedRole
      ? !isDraftEqual(draft, baselineDraft)
      : false;
  const saveDisabled =
    !canSubmitRole ||
    !isDirty ||
    (isCreateMode && !normalizeRoleNameInput(draft.name)) ||
    (isCreateMode && !(draft.displayName.trim() || draft.name.trim()));
  const footerStatusText = '当前无未保存改动';
  const diffSummary = useMemo(() => {
    const previous = new Set(
      (isCreateMode ? EMPTY_ROLE_DRAFT : baselineDraft).permissionNames,
    );
    const next = new Set(draft.permissionNames);
    let added = 0;
    let removed = 0;

    next.forEach((name) => {
      if (!previous.has(name)) {
        added += 1;
      }
    });
    previous.forEach((name) => {
      if (!next.has(name)) {
        removed += 1;
      }
    });

    return { added, removed };
  }, [baselineDraft, draft.permissionNames, isCreateMode]);

  const clearPermissionFilters = (options?: { resetModule?: boolean }) => {
    setPermissionKeyword('');
    setOnlyShowSelected(false);
    if (options?.resetModule) {
      setActiveModuleKey('workspace');
    }
  };

  const resetDraft = () => {
    setDraft(
      selectedRole ? buildRoleDraftFromRole(selectedRole) : EMPTY_ROLE_DRAFT,
    );
    clearPermissionFilters({ resetModule: true });
  };

  const togglePermission = (permissionName: string, checked: boolean) => {
    if (!canSubmitRole) {
      return;
    }
    setDraft((current) => ({
      ...current,
      permissionNames: checked
        ? normalizePermissionNames([...current.permissionNames, permissionName])
        : current.permissionNames.filter((name) => name !== permissionName),
    }));
  };

  const mutatePermissionSelection = (
    permissionNames: string[],
    mode: 'select' | 'clear' | 'invert',
  ) => {
    if (!permissionNames.length || !canSubmitRole) {
      return;
    }
    setDraft((current) => {
      const nextSet = new Set(current.permissionNames);
      permissionNames.forEach((permissionName) => {
        if (mode === 'select') {
          nextSet.add(permissionName);
          return;
        }
        if (mode === 'clear') {
          nextSet.delete(permissionName);
          return;
        }
        if (nextSet.has(permissionName)) {
          nextSet.delete(permissionName);
        } else {
          nextSet.add(permissionName);
        }
      });
      return {
        ...current,
        permissionNames: normalizePermissionNames(Array.from(nextSet)),
      };
    });
  };

  const applyPendingAction = (action: PendingAction) => {
    if (action.type === 'create') {
      setSelectedRoleId(EMPTY_ROLE_ID);
      setDraft(EMPTY_ROLE_DRAFT);
      clearPermissionFilters({ resetModule: true });
      return;
    }
    setSelectedRoleId(action.roleId);
    clearPermissionFilters({ resetModule: true });
  };

  const requestAction = (action: PendingAction) => {
    if (!isDirty) {
      applyPendingAction(action);
      return;
    }
    setPendingAction(action);
    setUnsavedModalOpen(true);
  };

  const closeUnsavedModal = () => {
    setUnsavedModalOpen(false);
    setPendingAction(null);
  };

  const submitRole = useCallback(async () => {
    if (!canSubmitRole) {
      return false;
    }

    const includeMetadata = isCreateMode || !isSystemRole;
    const payload = buildRolePayload({ draft, includeMetadata });
    if (isCreateMode && !payload.name) {
      message.warning('请先填写角色标识');
      return false;
    }

    try {
      setActionLoading({
        kind: isCreateMode ? 'create' : 'update',
        roleId: selectedRole?.id,
      });
      const response = await fetch(
        buildRuntimeScopeUrl(
          isCreateMode
            ? '/api/v1/platform/permissions'
            : `/api/v1/platform/permissions/${selectedRole?.id}`,
        ),
        {
          method: isCreateMode ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        },
      );
      const nextPayload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(nextPayload.error || '保存平台角色失败');
      }

      message.success(isCreateMode ? '平台角色已创建' : '平台角色已更新');
      const nextRoleId = nextPayload?.role?.id || selectedRole?.id || null;
      await loadPermissions(nextRoleId);
      return true;
    } catch (saveError: any) {
      message.error(saveError?.message || '保存平台角色失败');
      return false;
    } finally {
      setActionLoading(null);
    }
  }, [
    canSubmitRole,
    draft,
    isCreateMode,
    isSystemRole,
    loadPermissions,
    selectedRole?.id,
  ]);

  const handleSaveAndContinue = async () => {
    const success = await submitRole();
    if (!success) {
      return;
    }
    if (pendingAction) {
      applyPendingAction(pendingAction);
    }
    closeUnsavedModal();
  };

  const sidebarLoading = loading && roles.length === 0;
  const roleSaving =
    actionLoading?.kind === (isCreateMode ? 'create' : 'update') &&
    (isCreateMode || actionLoading.roleId === selectedRole?.id);

  const updateRoleStatus = useCallback(
    async (role: PlatformRoleCatalogItem, nextActive: boolean) => {
      if (role.isSystem || !canUpdateRoles) {
        return;
      }

      try {
        setActionLoading({ kind: 'update', roleId: role.id });
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/platform/permissions/${role.id}`),
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(
              buildRolePayload({
                draft: {
                  ...buildRoleDraftFromRole(role),
                  isActive: nextActive,
                },
                includeMetadata: true,
              }),
            ),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '更新角色状态失败');
        }

        message.success(nextActive ? '角色已启用' : '角色已停用');
        await loadPermissions(role.id);
      } catch (statusError: any) {
        message.error(statusError?.message || '更新角色状态失败');
      } finally {
        setActionLoading(null);
      }
    },
    [canUpdateRoles, loadPermissions],
  );

  const buildSidebarRoleMenuItems = (
    role: PlatformRoleCatalogItem,
  ): MenuProps['items'] => {
    const items: NonNullable<MenuProps['items']> = [
      {
        key: 'view',
        label: '编辑角色',
        onClick: () => requestAction({ type: 'select', roleId: role.id }),
      },
    ];

    if (!role.isSystem && canUpdateRoles) {
      items.push({
        key: role.isActive === false ? 'enable' : 'disable',
        label: role.isActive === false ? '启用角色' : '停用角色',
        onClick: () => {
          void updateRoleStatus(role, role.isActive === false);
        },
      });
    }

    return items;
  };

  const renderReadonlyField = (value: string, minWidth = 180) => (
    <div style={{ ...READONLY_FIELD_STYLE, minWidth }}>
      <Text>{value || '--'}</Text>
    </div>
  );

  const moduleOperationItems: MenuProps['items'] = [
    {
      key: 'select',
      label: '全选本模块',
      disabled: !canSubmitRole || activeModulePermissionNames.length === 0,
      onClick: () =>
        mutatePermissionSelection(activeModulePermissionNames, 'select'),
    },
    {
      key: 'clear',
      label: '清空本模块',
      disabled: !canSubmitRole || activeModulePermissionNames.length === 0,
      onClick: () =>
        mutatePermissionSelection(activeModulePermissionNames, 'clear'),
    },
    {
      key: 'invert',
      label: '反选本模块',
      disabled: !canSubmitRole || activeModulePermissionNames.length === 0,
      onClick: () =>
        mutatePermissionSelection(activeModulePermissionNames, 'invert'),
    },
  ];

  const moduleTabItems = useMemo(
    () =>
      moduleSummaries.map((module) => ({
        key: module.key,
        label: `${module.label} (${module.selectedCount}/${module.items.length})`,
      })),
    [moduleSummaries],
  );

  return (
    <ConsoleShellLayout
      title="权限管理"
      eyebrow="Platform Permissions"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="当前未登录"
          description="请先登录后再查看平台权限管理。"
        />
      ) : !canAccessPage ? (
        <Alert
          className="console-alert"
          type="error"
          showIcon
          message="当前账号没有平台治理权限"
          description="平台权限管理仅对具备平台角色目录查看权限的角色开放。"
        />
      ) : (
        <div
          style={{
            display: 'flex',
            gap: 12,
            minHeight: 'calc(100vh - 180px)',
            alignItems: 'stretch',
          }}
        >
          <Card
            size="small"
            style={{
              width: 296,
              minWidth: 280,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
            bodyStyle={PANEL_BODY_STYLE}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <Space size={8}>
                <Text strong style={{ fontSize: 15 }}>
                  角色列表
                </Text>
              </Space>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canCreateRoles}
                onClick={() => requestAction({ type: 'create' })}
              >
                新建
              </Button>
            </div>

            <Input.Search
              allowClear
              value={roleKeyword}
              placeholder="搜索角色"
              onChange={(event) => setRoleKeyword(event.target.value)}
              style={{ marginBottom: 8 }}
            />

            {error ? (
              <Alert
                type="warning"
                showIcon
                message={error}
                style={{ marginBottom: 8 }}
              />
            ) : null}

            <div style={{ flex: 1, overflow: 'auto', paddingRight: 4 }}>
              {sidebarLoading ? (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Card key={index} size="small">
                      <Skeleton active title={false} paragraph={{ rows: 2 }} />
                    </Card>
                  ))}
                </Space>
              ) : visibleRoles.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无匹配角色"
                />
              ) : (
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {visibleRoles.map((role) => {
                    const selected =
                      selectedRoleId === role.id && !isCreateMode;
                    return (
                      <div
                        key={role.id}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          requestAction({ type: 'select', roleId: role.id })
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            requestAction({ type: 'select', roleId: role.id });
                          }
                        }}
                        style={{
                          border: selected
                            ? '1px solid var(--ant-color-primary-border)'
                            : '1px solid var(--ant-color-border-secondary)',
                          borderInlineStart: selected
                            ? '3px solid var(--ant-color-primary)'
                            : '3px solid transparent',
                          borderRadius: 8,
                          padding: '8px 8px 8px 10px',
                          cursor: 'pointer',
                          background: selected
                            ? 'rgba(22, 119, 255, 0.12)'
                            : 'var(--ant-color-bg-container)',
                          boxShadow: selected
                            ? '0 0 0 1px rgba(22, 119, 255, 0.14) inset'
                            : 'none',
                          transition: 'all 120ms ease',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: 6,
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <Space size={4} wrap>
                              <Text strong ellipsis style={{ maxWidth: 148 }}>
                                {role.displayName || role.name}
                              </Text>
                              <Tag
                                color={role.isSystem ? 'gold' : 'blue'}
                                style={{ marginInlineEnd: 0 }}
                              >
                                {role.isSystem ? '系统' : '自定义'}
                              </Tag>
                            </Space>
                            <Text
                              type="secondary"
                              style={{
                                display: 'block',
                                marginTop: 4,
                                fontSize: 12,
                              }}
                            >
                              {role.name}
                            </Text>
                            <div
                              style={{
                                marginTop: 8,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                flexWrap: 'wrap',
                              }}
                            >
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {role.permissionNames.length} 项权限
                              </Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {role.bindingCount} 个绑定
                              </Text>
                              <Badge
                                status={
                                  role.isActive === false
                                    ? 'default'
                                    : 'success'
                                }
                                text={role.isActive === false ? '停用' : '启用'}
                              />
                            </div>
                          </div>
                          <Dropdown
                            trigger={['click']}
                            menu={{ items: buildSidebarRoleMenuItems(role) }}
                          >
                            <Button
                              type="text"
                              icon={<MoreOutlined />}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </Dropdown>
                        </div>
                      </div>
                    );
                  })}
                </Space>
              )}
            </div>
          </Card>

          <Card
            size="small"
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
            bodyStyle={PANEL_BODY_STYLE}
          >
            {!selectedRole && !isCreateMode ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  loading ? '正在加载角色目录…' : '请选择左侧角色查看详情'
                }
              />
            ) : (
              <>
                <div
                  style={{
                    borderBottom: '1px solid var(--ant-color-border-secondary)',
                    paddingBottom: 12,
                    marginBottom: 12,
                  }}
                >
                  <Space
                    direction="vertical"
                    size={10}
                    style={{ width: '100%' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Space size={12} wrap style={{ flex: 1, minWidth: 0 }}>
                        <Space size={6} align="center">
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            角色标识
                          </Text>
                          {selectedRole && isSystemRole ? (
                            renderReadonlyField(draft.name, 180)
                          ) : (
                            <Input
                              style={{ width: 200 }}
                              value={draft.name}
                              disabled={metadataReadOnly && !isCreateMode}
                              placeholder="例如：platform_operator"
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  name: normalizeRoleNameInput(
                                    event.target.value,
                                  ),
                                }))
                              }
                            />
                          )}
                        </Space>

                        <Space size={6} align="center">
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            角色名称
                          </Text>
                          {selectedRole && isSystemRole ? (
                            renderReadonlyField(
                              draft.displayName || draft.name,
                              180,
                            )
                          ) : (
                            <Input
                              style={{ width: 220 }}
                              value={draft.displayName}
                              disabled={metadataReadOnly && !isCreateMode}
                              placeholder="默认使用角色标识"
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  displayName: event.target.value,
                                }))
                              }
                            />
                          )}
                        </Space>
                      </Space>

                      <Space size={8} align="center">
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          启用状态
                        </Text>
                        <Switch
                          checked={draft.isActive}
                          disabled={metadataReadOnly && !isCreateMode}
                          onChange={(checked) =>
                            setDraft((current) => ({
                              ...current,
                              isActive: checked,
                            }))
                          }
                        />
                      </Space>
                    </div>

                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {isSystemRole
                        ? '系统角色仅允许调整权限项，不允许修改角色标识、名称和启用状态。'
                        : '自定义角色支持创建、编辑、停用和删除。'}
                    </Text>
                  </Space>
                </div>

                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    background: 'var(--ant-color-bg-container)',
                    borderBottom: '1px solid var(--ant-color-border-secondary)',
                    marginBottom: 6,
                  }}
                >
                  <Tabs
                    size="small"
                    activeKey={activeModuleKey}
                    onChange={(key) =>
                      setActiveModuleKey(key as PlatformPermissionModuleKey)
                    }
                    style={{ marginBottom: 0, paddingTop: 2 }}
                  >
                    {moduleTabItems.map((module) => (
                      <TabPane key={module.key} tab={module.label} />
                    ))}
                  </Tabs>
                </div>

                <div style={FILTER_BAR_STYLE}>
                  <Space size={[8, 8]} wrap>
                    <Input.Search
                      allowClear
                      value={permissionKeyword}
                      placeholder="搜索权限"
                      style={{ width: 220 }}
                      onChange={(event) =>
                        setPermissionKeyword(event.target.value)
                      }
                    />
                    <Space size={6}>
                      <Switch
                        size="small"
                        checked={onlyShowSelected}
                        onChange={(checked) => setOnlyShowSelected(checked)}
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        仅看已选
                      </Text>
                    </Space>
                  </Space>
                  <Space size={[8, 8]} wrap>
                    <Dropdown
                      trigger={['click']}
                      menu={{ items: moduleOperationItems }}
                    >
                      <Button
                        icon={<MoreOutlined />}
                        disabled={
                          !canSubmitRole ||
                          activeModulePermissionNames.length === 0
                        }
                      >
                        模块操作
                      </Button>
                    </Dropdown>
                    <Button
                      disabled={!permissionKeyword && !onlyShowSelected}
                      onClick={() => clearPermissionFilters()}
                    >
                      清空筛选
                    </Button>
                  </Space>
                </div>

                <div
                  style={{
                    flex: 1,
                    overflow: 'auto',
                    paddingRight: 4,
                    paddingBottom: 72,
                  }}
                >
                  {loading && permissionCatalog.length === 0 ? (
                    <Space
                      direction="vertical"
                      size={10}
                      style={{ width: '100%' }}
                    >
                      {Array.from({ length: 2 }).map((_, index) => (
                        <Card key={index}>
                          <Skeleton
                            active
                            title={false}
                            paragraph={{ rows: 3 }}
                          />
                        </Card>
                      ))}
                    </Space>
                  ) : permissionGroups.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="当前筛选下暂无权限项"
                    />
                  ) : (
                    <Space
                      direction="vertical"
                      size={10}
                      style={{ width: '100%' }}
                    >
                      {permissionGroups.map((group) => {
                        const selectedCount = group.items.filter((permission) =>
                          selectedPermissionSet.has(permission.name),
                        ).length;
                        const groupPermissionNames = group.items.map(
                          (permission) => permission.name,
                        );

                        return (
                          <Card
                            key={group.key}
                            size="small"
                            title={
                              <Space size={8} wrap>
                                <Text strong>{group.label}</Text>
                                <Tag
                                  color="default"
                                  style={{ marginInlineEnd: 0 }}
                                >
                                  {selectedCount}/{group.items.length}
                                </Tag>
                              </Space>
                            }
                            extra={
                              <Dropdown
                                trigger={['click']}
                                menu={{
                                  items: [
                                    {
                                      key: 'select',
                                      label: '全选',
                                      disabled: !canSubmitRole,
                                      onClick: () =>
                                        mutatePermissionSelection(
                                          groupPermissionNames,
                                          'select',
                                        ),
                                    },
                                    {
                                      key: 'clear',
                                      label: '清空',
                                      disabled: !canSubmitRole,
                                      onClick: () =>
                                        mutatePermissionSelection(
                                          groupPermissionNames,
                                          'clear',
                                        ),
                                    },
                                    {
                                      key: 'invert',
                                      label: '反选',
                                      disabled: !canSubmitRole,
                                      onClick: () =>
                                        mutatePermissionSelection(
                                          groupPermissionNames,
                                          'invert',
                                        ),
                                    },
                                  ],
                                }}
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<MoreOutlined />}
                                >
                                  更多
                                </Button>
                              </Dropdown>
                            }
                            bodyStyle={{ padding: 8 }}
                            style={{
                              borderRadius: 8,
                            }}
                          >
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns:
                                  'repeat(auto-fill, minmax(220px, 1fr))',
                                gap: 8,
                              }}
                            >
                              {group.items.map((permission) => {
                                const checked = selectedPermissionSet.has(
                                  permission.name,
                                );
                                const action = getActionDescriptor(
                                  permission.name,
                                );
                                const permissionDescription =
                                  getPermissionDescription(permission);
                                return (
                                  <label
                                    key={permission.name}
                                    style={{
                                      minHeight: 88,
                                      border: checked
                                        ? '1px solid var(--ant-color-primary)'
                                        : '1px solid var(--ant-color-border)',
                                      borderRadius: 8,
                                      padding: 7,
                                      background:
                                        'var(--ant-color-bg-container)',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      gap: 8,
                                      alignItems: 'flex-start',
                                      boxShadow: checked
                                        ? '0 0 0 1px rgba(22, 119, 255, 0.08) inset'
                                        : '0 0 0 1px rgba(15, 23, 42, 0.04) inset',
                                    }}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      disabled={!canSubmitRole}
                                      onChange={(event) =>
                                        togglePermission(
                                          permission.name,
                                          event.target.checked,
                                        )
                                      }
                                    />
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <Space size={4} wrap>
                                        <span style={ACTION_LABEL_STYLE}>
                                          {action.label}
                                        </span>
                                        <Text
                                          strong
                                          style={{ maxWidth: 140 }}
                                          ellipsis
                                        >
                                          {getPermissionHeadline(
                                            permission.name,
                                          )}
                                        </Text>
                                      </Space>
                                      <div>
                                        <Text
                                          type="secondary"
                                          style={{
                                            fontSize: 12,
                                            maxWidth: 180,
                                          }}
                                          ellipsis={{
                                            tooltip: permission.name,
                                          }}
                                        >
                                          {permission.name}
                                        </Text>
                                      </div>
                                      <Paragraph
                                        type="secondary"
                                        style={{
                                          marginTop: 1,
                                          marginBottom: 0,
                                          fontSize: 12,
                                        }}
                                        ellipsis={{
                                          rows: 1,
                                          tooltip: permissionDescription,
                                        }}
                                      >
                                        {permissionDescription}
                                      </Paragraph>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </Card>
                        );
                      })}
                    </Space>
                  )}
                </div>

                <div style={FOOTER_BAR_STYLE}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Space size={8} wrap>
                      <Text type={isDirty ? 'warning' : 'secondary'}>
                        {isDirty
                          ? `已修改：新增 ${diffSummary.added} 项，移除 ${diffSummary.removed} 项`
                          : footerStatusText}
                      </Text>
                    </Space>
                    <Space size={8} wrap>
                      <Button
                        icon={<ReloadOutlined />}
                        disabled={!isDirty}
                        onClick={resetDraft}
                      >
                        重置改动
                      </Button>
                      <Button
                        type="primary"
                        icon={<SaveOutlined />}
                        disabled={saveDisabled}
                        loading={roleSaving}
                        onClick={() => {
                          void submitRole();
                        }}
                      >
                        {isCreateMode ? '新建角色' : '保存变更'}
                      </Button>
                    </Space>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      <PermissionsRoleCatalogUnsavedModal
        open={unsavedModalOpen}
        loading={Boolean(roleSaving)}
        onCancel={closeUnsavedModal}
        onDiscard={() => {
          if (pendingAction) {
            applyPendingAction(pendingAction);
          }
          closeUnsavedModal();
        }}
        onSave={() => {
          void handleSaveAndContinue();
        }}
      />
    </ConsoleShellLayout>
  );
}
