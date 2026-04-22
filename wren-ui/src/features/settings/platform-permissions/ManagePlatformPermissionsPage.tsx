import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  Row,
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
  ACTION_TAG_COLORS,
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

const FULL_WIDTH_STYLE = {
  width: '100%',
} as const;

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

const PANEL_BODY_STYLE = {
  padding: '12px 12px 8px',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
} as const;

const PANEL_COLUMN_STYLE = {
  display: 'flex',
} as const;

const PANEL_CARD_STYLE = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
} as const;

const LAYOUT_ROW_STYLE = {
  minHeight: 'calc(100vh - 180px)',
} as const;

const SIDEBAR_SCROLL_STYLE = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  paddingRight: 4,
} as const;

const ROLE_ITEM_BODY_STYLE = {
  padding: '8px 8px 8px 10px',
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

const EDITOR_SECTION_STYLE = {
  width: '100%',
  borderBottom: '1px solid var(--ant-color-border-secondary)',
  paddingBottom: 12,
  marginBottom: 12,
} as const;

const EDITOR_STICKY_TABS_STYLE = {
  width: '100%',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--ant-color-bg-container)',
  borderBottom: '1px solid var(--ant-color-border-secondary)',
  marginBottom: 6,
} as const;

const EDITOR_SCROLL_BODY_STYLE = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  paddingRight: 4,
  paddingBottom: 72,
} as const;

const getRoleListItemStyle = (selected: boolean) =>
  ({
    width: '100%',
    border: selected
      ? '1px solid var(--ant-color-primary-border)'
      : '1px solid var(--ant-color-border-secondary)',
    borderRadius: 8,
    cursor: 'pointer',
    background: selected
      ? 'var(--ant-color-primary-bg)'
      : 'var(--ant-color-bg-container)',
    boxShadow: selected ? '0 0 0 1px rgba(22, 119, 255, 0.12) inset' : 'none',
    transition: 'all 120ms ease',
  }) as const;

const getPermissionOptionStyle = (checked: boolean) =>
  ({
    minHeight: 88,
    border: checked
      ? '1px solid var(--ant-color-primary)'
      : '1px solid var(--ant-color-border)',
    borderRadius: 8,
    padding: 7,
    background: 'var(--ant-color-bg-container)',
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    boxShadow: checked
      ? '0 0 0 1px rgba(22, 119, 255, 0.08) inset'
      : '0 0 0 1px rgba(15, 23, 42, 0.04) inset',
  }) as const;

const PERMISSION_OPTION_CONTENT_STYLE = {
  width: '100%',
  alignItems: 'flex-start',
} as const;

const PERMISSION_OPTION_META_STYLE = {
  minWidth: 0,
  flex: 1,
} as const;

const PERMISSION_NAME_STYLE = {
  display: 'block',
  marginTop: 6,
  fontSize: 12,
  maxWidth: 180,
  lineHeight: 1.35,
} as const;

const PERMISSION_DESCRIPTION_STYLE = {
  marginTop: 0,
  marginBottom: 0,
  fontSize: 12,
  lineHeight: 1.35,
} as const;

const ReadonlyField = ({
  fallback = '--',
  minWidth,
  value,
}: {
  fallback?: string;
  minWidth: number;
  value?: string | null;
}) => (
  <Input
    readOnly
    value={value?.trim() || fallback}
    style={{ width: minWidth }}
  />
);

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
          title="当前未登录"
          description="请先登录后再查看平台权限管理。"
        />
      ) : !canAccessPage ? (
        <Alert
          className="console-alert"
          type="error"
          showIcon
          title="当前账号没有平台治理权限"
          description="平台权限管理仅对具备平台角色目录查看权限的角色开放。"
        />
      ) : (
        <Row gutter={[12, 12]} align="stretch" style={LAYOUT_ROW_STYLE}>
          <Col flex="296px" style={{ ...PANEL_COLUMN_STYLE, minWidth: 280 }}>
            <Card
              size="small"
              style={PANEL_CARD_STYLE}
              styles={{ body: PANEL_BODY_STYLE }}
            >
              <Row
                align="middle"
                gutter={[8, 8]}
                justify="space-between"
                style={{ marginBottom: 8 }}
              >
                <Col flex="auto">
                  <Text strong style={{ fontSize: 15 }}>
                    角色列表
                  </Text>
                </Col>
                <Col>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    disabled={!canCreateRoles}
                    onClick={() => requestAction({ type: 'create' })}
                  >
                    新建
                  </Button>
                </Col>
              </Row>

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
                  title={error}
                  style={{ marginBottom: 8 }}
                />
              ) : null}

              <Space
                orientation="vertical"
                size={0}
                style={SIDEBAR_SCROLL_STYLE}
              >
                {sidebarLoading ? (
                  <Space
                    orientation="vertical"
                    size={8}
                    style={FULL_WIDTH_STYLE}
                  >
                    {Array.from({ length: 3 }).map((_, index) => (
                      <Card key={index} size="small">
                        <Skeleton
                          active
                          title={false}
                          paragraph={{ rows: 2 }}
                        />
                      </Card>
                    ))}
                  </Space>
                ) : visibleRoles.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无匹配角色"
                  />
                ) : (
                  <Space
                    orientation="vertical"
                    size={6}
                    style={FULL_WIDTH_STYLE}
                  >
                    {visibleRoles.map((role) => {
                      const selected =
                        selectedRoleId === role.id && !isCreateMode;
                      return (
                        <Card
                          key={role.id}
                          size="small"
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            requestAction({ type: 'select', roleId: role.id })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              requestAction({
                                type: 'select',
                                roleId: role.id,
                              });
                            }
                          }}
                          style={getRoleListItemStyle(selected)}
                          styles={{ body: ROLE_ITEM_BODY_STYLE }}
                        >
                          <Row
                            align="top"
                            gutter={[6, 6]}
                            justify="space-between"
                          >
                            <Col flex="auto" style={{ minWidth: 0 }}>
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
                              <Space
                                size={[8, 6]}
                                wrap
                                style={{ marginTop: 8 }}
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
                                  text={
                                    role.isActive === false ? '停用' : '启用'
                                  }
                                />
                              </Space>
                            </Col>
                            <Col>
                              <Dropdown
                                trigger={['click']}
                                menu={{
                                  items: buildSidebarRoleMenuItems(role),
                                }}
                              >
                                <Button
                                  type="text"
                                  icon={<MoreOutlined />}
                                  onClick={(event) => event.stopPropagation()}
                                />
                              </Dropdown>
                            </Col>
                          </Row>
                        </Card>
                      );
                    })}
                  </Space>
                )}
              </Space>
            </Card>
          </Col>

          <Col flex="auto" style={{ ...PANEL_COLUMN_STYLE, minWidth: 0 }}>
            <Card
              size="small"
              style={PANEL_CARD_STYLE}
              styles={{ body: PANEL_BODY_STYLE }}
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
                  <Space
                    orientation="vertical"
                    size={10}
                    style={EDITOR_SECTION_STYLE}
                  >
                    <Row
                      gutter={[12, 12]}
                      align="middle"
                      justify="space-between"
                    >
                      <Col flex="auto" style={{ minWidth: 0 }}>
                        <Form layout="vertical">
                          <Row gutter={[12, 0]}>
                            <Col xs={24} md={12}>
                              <Form.Item
                                label="角色标识"
                                style={{ marginBottom: 0 }}
                              >
                                {selectedRole && isSystemRole ? (
                                  <ReadonlyField
                                    value={draft.name}
                                    minWidth={180}
                                  />
                                ) : (
                                  <Input
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
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={12}>
                              <Form.Item
                                label="角色名称"
                                style={{ marginBottom: 0 }}
                              >
                                {selectedRole && isSystemRole ? (
                                  <ReadonlyField
                                    value={draft.displayName || draft.name}
                                    minWidth={180}
                                  />
                                ) : (
                                  <Input
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
                              </Form.Item>
                            </Col>
                          </Row>
                        </Form>
                      </Col>

                      <Col>
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
                      </Col>
                    </Row>

                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {isSystemRole
                        ? '系统角色仅允许调整权限项，不允许修改角色标识、名称和启用状态。'
                        : '自定义角色支持创建、编辑、停用和删除。'}
                    </Text>
                  </Space>

                  <Space
                    orientation="vertical"
                    size={0}
                    style={EDITOR_STICKY_TABS_STYLE}
                  >
                    <Tabs
                      size="small"
                      activeKey={activeModuleKey}
                      onChange={(key) =>
                        setActiveModuleKey(key as PlatformPermissionModuleKey)
                      }
                      style={{ marginBottom: 0, paddingTop: 2 }}
                      items={moduleTabItems.map((module) => ({
                        key: module.key,
                        label: module.label,
                      }))}
                    />
                  </Space>

                  <Row
                    gutter={[8, 8]}
                    justify="space-between"
                    style={FILTER_BAR_STYLE}
                  >
                    <Col flex="auto">
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
                    </Col>
                    <Col>
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
                    </Col>
                  </Row>

                  <Space
                    orientation="vertical"
                    size={0}
                    style={EDITOR_SCROLL_BODY_STYLE}
                  >
                    {loading && permissionCatalog.length === 0 ? (
                      <Space
                        orientation="vertical"
                        size={10}
                        style={FULL_WIDTH_STYLE}
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
                        orientation="vertical"
                        size={10}
                        style={FULL_WIDTH_STYLE}
                      >
                        {permissionGroups.map((group) => {
                          const selectedCount = group.items.filter(
                            (permission) =>
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
                              styles={{ body: { padding: 8 } }}
                              style={{
                                borderRadius: 8,
                              }}
                            >
                              <Row gutter={[8, 8]}>
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
                                    <Col
                                      key={permission.name}
                                      xs={24}
                                      md={12}
                                      xl={8}
                                    >
                                      <label
                                        style={getPermissionOptionStyle(
                                          checked,
                                        )}
                                      >
                                        <Space
                                          align="start"
                                          size={8}
                                          style={
                                            PERMISSION_OPTION_CONTENT_STYLE
                                          }
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
                                          <Space
                                            orientation="vertical"
                                            size={2}
                                            style={PERMISSION_OPTION_META_STYLE}
                                          >
                                            <Space size={[4, 4]} wrap>
                                              <Tag
                                                color={
                                                  ACTION_TAG_COLORS[
                                                    action.key
                                                  ] || 'blue'
                                                }
                                              >
                                                {action.label}
                                              </Tag>
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
                                            <Text
                                              type="secondary"
                                              style={PERMISSION_NAME_STYLE}
                                              ellipsis={{
                                                tooltip: permission.name,
                                              }}
                                            >
                                              {permission.name}
                                            </Text>
                                            <Paragraph
                                              type="secondary"
                                              style={
                                                PERMISSION_DESCRIPTION_STYLE
                                              }
                                              ellipsis={{
                                                rows: 1,
                                                tooltip: permissionDescription,
                                              }}
                                            >
                                              {permissionDescription}
                                            </Paragraph>
                                          </Space>
                                        </Space>
                                      </label>
                                    </Col>
                                  );
                                })}
                              </Row>
                            </Card>
                          );
                        })}
                      </Space>
                    )}
                  </Space>

                  <Space
                    orientation="vertical"
                    size={0}
                    style={FOOTER_BAR_STYLE}
                  >
                    <Row align="middle" gutter={[8, 8]} justify="space-between">
                      <Col flex="auto">
                        <Space size={8} wrap>
                          <Text type={isDirty ? 'warning' : 'secondary'}>
                            {isDirty
                              ? `已修改：新增 ${diffSummary.added} 项，移除 ${diffSummary.removed} 项`
                              : footerStatusText}
                          </Text>
                        </Space>
                      </Col>
                      <Col>
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
                      </Col>
                    </Row>
                  </Space>
                </>
              )}
            </Card>
          </Col>
        </Row>
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
