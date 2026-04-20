import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'antd';
import CopyOutlined from '@ant-design/icons/CopyOutlined';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import type {
  WorkspacePermissionCatalogItem,
  WorkspaceRoleCatalogItem,
} from '@/features/settings/workspaceGovernanceShared';
import { summarizePermissionDiff } from './permissionsPageUtils';
import PermissionsRoleCatalogEditor from './PermissionsRoleCatalogEditor';
import PermissionsRoleCatalogSidebar from './PermissionsRoleCatalogSidebar';
import PermissionsRoleCatalogUnsavedModal from './PermissionsRoleCatalogUnsavedModal';
import {
  EMPTY_ROLE_DRAFT,
  EMPTY_ROLE_ID,
  MODULE_DEFINITIONS,
  buildRoleDraftFromRole,
  getModuleKey,
  getPermissionResourceKey,
  getResourceLabel,
  isDraftEqual,
  matchesRoleKeyword,
  normalizePermissionNames,
  shouldHidePermission,
  type PermissionGroup,
  type PermissionModuleKey,
  type RoleDraft,
  type RoleMenuItem,
} from './permissionsRoleCatalogMeta';
import type { WorkspaceRoleDraftPayload } from './usePermissionsCustomRoles';
import usePermissionsRoleCatalogActions from './usePermissionsRoleCatalogActions';

export default function PermissionsRoleCatalogSection({
  canReadRoles,
  canManageRoles,
  roleCatalog,
  roleCatalogLoading,
  permissionCatalog,
  roleActionLoading,
  onCreateCustomRole,
  onUpdateCustomRole,
  onDeleteCustomRole,
}: {
  canReadRoles: boolean;
  canManageRoles: boolean;
  roleCatalog: WorkspaceRoleCatalogItem[];
  roleCatalogLoading: boolean;
  permissionCatalog: WorkspacePermissionCatalogItem[];
  roleActionLoading: {
    kind: 'create' | 'update' | 'delete';
    roleId?: string;
  } | null;
  onCreateCustomRole: (
    payload: WorkspaceRoleDraftPayload,
  ) => Promise<string | null> | string | null;
  onUpdateCustomRole: (
    roleId: string,
    payload: WorkspaceRoleDraftPayload,
  ) => Promise<boolean> | boolean;
  onDeleteCustomRole: (roleId: string) => Promise<boolean> | boolean;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleKeyword, setRoleKeyword] = useState('');
  const [permissionKeyword, setPermissionKeyword] = useState('');
  const [onlyShowSelected, setOnlyShowSelected] = useState(false);
  const [activeModuleKey, setActiveModuleKey] =
    useState<PermissionModuleKey>('people');
  const [draft, setDraft] = useState<RoleDraft>(EMPTY_ROLE_DRAFT);

  const selectedRole = useMemo(
    () => roleCatalog.find((role) => role.id === selectedRoleId) || null,
    [roleCatalog, selectedRoleId],
  );

  useEffect(() => {
    if (selectedRoleId === EMPTY_ROLE_ID) {
      return;
    }
    if (!roleCatalog.length) {
      setSelectedRoleId(null);
      setDraft(EMPTY_ROLE_DRAFT);
      return;
    }
    if (
      !selectedRoleId ||
      !roleCatalog.some((role) => role.id === selectedRoleId)
    ) {
      setSelectedRoleId(roleCatalog[0].id);
    }
  }, [roleCatalog, selectedRoleId]);

  useEffect(() => {
    if (selectedRoleId === EMPTY_ROLE_ID) {
      return;
    }
    if (selectedRole) {
      setDraft(buildRoleDraftFromRole(selectedRole));
    }
  }, [selectedRole, selectedRoleId]);

  const visibleRoles = useMemo(() => {
    const normalizedKeyword = roleKeyword.trim().toLowerCase();
    return roleCatalog.filter((role) =>
      matchesRoleKeyword(role, normalizedKeyword),
    );
  }, [roleCatalog, roleKeyword]);

  const visiblePermissionCatalog = useMemo(
    () =>
      permissionCatalog.filter(
        (permission) => !shouldHidePermission(permission.name),
      ),
    [permissionCatalog],
  );

  const selectedPermissionSet = useMemo(
    () => new Set(draft.permissionNames || []),
    [draft.permissionNames],
  );

  const moduleSummaries = useMemo(() => {
    const normalizedKeyword = permissionKeyword.trim().toLowerCase();
    return MODULE_DEFINITIONS.map((module) => {
      const items = visiblePermissionCatalog.filter((permission) => {
        if (getModuleKey(permission.name) !== module.key) {
          return false;
        }
        if (onlyShowSelected && !selectedPermissionSet.has(permission.name)) {
          return false;
        }
        if (!normalizedKeyword) {
          return true;
        }
        const source = [permission.name, permission.description || '']
          .join(' ')
          .toLowerCase();
        return source.includes(normalizedKeyword);
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
    permissionKeyword,
    selectedPermissionSet,
    visiblePermissionCatalog,
  ]);

  useEffect(() => {
    if (!moduleSummaries.some((module) => module.key === activeModuleKey)) {
      setActiveModuleKey(moduleSummaries[0]?.key || 'people');
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
      Record<string, WorkspacePermissionCatalogItem[]>
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
    () =>
      (activeModule?.items || [])
        .filter((permission) => permission.assignable)
        .map((permission) => permission.name),
    [activeModule],
  );

  const isCreateMode = selectedRoleId === EMPTY_ROLE_ID;
  const isSystemRole = Boolean(selectedRole?.isSystem);
  const metadataReadOnly = !canManageRoles || isSystemRole;
  const permissionReadOnly = !canManageRoles;
  const baselineDraft = selectedRole
    ? buildRoleDraftFromRole(selectedRole)
    : EMPTY_ROLE_DRAFT;
  const isDirty = isCreateMode
    ? !isDraftEqual(draft, EMPTY_ROLE_DRAFT)
    : selectedRole
      ? !isDraftEqual(draft, baselineDraft)
      : false;

  const diffSummary = useMemo(
    () =>
      summarizePermissionDiff(
        baselineDraft.permissionNames,
        draft.permissionNames,
      ),
    [baselineDraft.permissionNames, draft.permissionNames],
  );

  const resetFilters = () => {
    setPermissionKeyword('');
    setOnlyShowSelected(false);
    setActiveModuleKey('people');
  };

  const clearPermissionFilters = () => {
    setPermissionKeyword('');
    setOnlyShowSelected(false);
  };

  const resetDraft = () => {
    setDraft(
      selectedRole ? buildRoleDraftFromRole(selectedRole) : EMPTY_ROLE_DRAFT,
    );
    resetFilters();
  };

  const togglePermission = (permissionName: string, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      permissionNames: checked
        ? normalizePermissionNames([...current.permissionNames, permissionName])
        : current.permissionNames.filter((name) => name !== permissionName),
    }));
  };

  const mutateModuleSelection = (checked: boolean) => {
    if (!activeModulePermissionNames.length) {
      return;
    }
    setDraft((current) => {
      const permissionSet = new Set(current.permissionNames);
      activeModulePermissionNames.forEach((name) => {
        if (checked) {
          permissionSet.add(name);
        } else {
          permissionSet.delete(name);
        }
      });
      return {
        ...current,
        permissionNames: normalizePermissionNames(Array.from(permissionSet)),
      };
    });
  };

  const mutateGroupSelection = (
    permissionNames: string[],
    mode: 'select' | 'clear' | 'invert',
  ) => {
    setDraft((current) => {
      const permissionSet = new Set(current.permissionNames);
      permissionNames.forEach((name) => {
        if (mode === 'select') {
          permissionSet.add(name);
        } else if (mode === 'clear') {
          permissionSet.delete(name);
        } else if (permissionSet.has(name)) {
          permissionSet.delete(name);
        } else {
          permissionSet.add(name);
        }
      });
      return {
        ...current,
        permissionNames: normalizePermissionNames(Array.from(permissionSet)),
      };
    });
  };

  const {
    closeUnsavedModal,
    handleDiscardAndContinue,
    handleSaveAndContinue,
    handleSaveRole,
    requestIntent,
    unsavedModalOpen,
  } = usePermissionsRoleCatalogActions({
    draft,
    isCreateMode,
    isDirty,
    isSystemRole,
    onCreateCustomRole,
    onDeleteCustomRole,
    onUpdateCustomRole,
    resetFilters,
    roleCatalog,
    selectedRole,
    selectedRoleId,
    setDraft,
    setSelectedRoleId,
  });

  const getRoleMenuItems = (role: WorkspaceRoleCatalogItem): RoleMenuItem[] => {
    const deleting =
      roleActionLoading?.kind === 'delete' &&
      roleActionLoading.roleId === role.id;
    return [
      {
        key: `select-${role.id}`,
        label: '查看详情',
        onClick: () => requestIntent({ type: 'select', roleId: role.id }),
      },
      ...(canManageRoles
        ? [
            {
              key: `copy-${role.id}`,
              icon: <CopyOutlined />,
              label: '复制角色',
              onClick: () => requestIntent({ type: 'copy', roleId: role.id }),
            },
          ]
        : []),
      ...(!role.isSystem && canManageRoles
        ? [
            {
              key: `status-${role.id}`,
              label: role.isActive === false ? '启用角色' : '停用角色',
              onClick: () =>
                requestIntent({
                  type: 'toggleStatus',
                  roleId: role.id,
                  nextActive: role.isActive === false,
                }),
            },
            {
              key: `delete-${role.id}`,
              danger: true,
              icon: <DeleteOutlined />,
              disabled: deleting,
              label: '删除角色',
              onClick: () => requestIntent({ type: 'delete', roleId: role.id }),
            },
          ]
        : []),
    ];
  };

  const saveDisabled = isCreateMode
    ? !canManageRoles || !draft.name.trim() || !isDirty
    : !canManageRoles || !isDirty;

  const footerStatusText = isCreateMode
    ? isDirty
      ? `待创建角色：已配置 ${draft.permissionNames.length} 项权限`
      : '当前无未保存改动'
    : isDirty
      ? `已修改：新增 ${diffSummary.added} 项，移除 ${diffSummary.removed} 项`
      : '当前无未保存改动';

  const tabsItems = moduleSummaries.map((module) => ({
    key: module.key,
    label: `${module.label} (${module.selectedCount}/${module.items.length})`,
  }));

  if (!canReadRoles) {
    return (
      <Alert
        type="info"
        showIcon
        message="当前为只读提示"
        description="你没有 role.read 权限，暂时无法查看角色目录。"
      />
    );
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 10,
          minHeight: 720,
          alignItems: 'stretch',
        }}
      >
        <PermissionsRoleCatalogSidebar
          canManageRoles={canManageRoles}
          getRoleMenuItems={getRoleMenuItems}
          isCreateMode={isCreateMode}
          roleCatalogLoading={roleCatalogLoading}
          roleKeyword={roleKeyword}
          roleActionLoading={roleActionLoading}
          selectedRoleId={selectedRoleId}
          visibleRoles={visibleRoles}
          onCreateRole={() => requestIntent({ type: 'create' })}
          onRoleKeywordChange={setRoleKeyword}
          onSelectRole={(roleId) => requestIntent({ type: 'select', roleId })}
        />

        <PermissionsRoleCatalogEditor
          activeModuleKey={activeModuleKey}
          activeModulePermissionNames={activeModulePermissionNames}
          canManageRoles={canManageRoles}
          draft={draft}
          footerStatusText={footerStatusText}
          isCreateMode={isCreateMode}
          isDirty={isDirty}
          isSystemRole={isSystemRole}
          metadataReadOnly={metadataReadOnly}
          onlyShowSelected={onlyShowSelected}
          permissionGroups={permissionGroups}
          permissionKeyword={permissionKeyword}
          permissionReadOnly={permissionReadOnly}
          roleActionLoading={roleActionLoading}
          roleCatalogLoading={roleCatalogLoading}
          saveDisabled={saveDisabled}
          selectedPermissionSet={selectedPermissionSet}
          selectedRole={selectedRole}
          tabsItems={tabsItems}
          onActiveChange={(checked) =>
            setDraft((current) => ({ ...current, isActive: checked }))
          }
          onActiveModuleChange={setActiveModuleKey}
          onClearFilters={clearPermissionFilters}
          onDescriptionChange={(value) =>
            setDraft((current) => ({ ...current, description: value }))
          }
          onDisplayNameChange={(value) =>
            setDraft((current) => ({ ...current, displayName: value }))
          }
          onMutateGroupSelection={mutateGroupSelection}
          onMutateModuleSelection={mutateModuleSelection}
          onNameChange={(value) =>
            setDraft((current) => ({ ...current, name: value }))
          }
          onOnlyShowSelectedChange={setOnlyShowSelected}
          onPermissionKeywordChange={setPermissionKeyword}
          onResetDraft={resetDraft}
          onSaveRole={() => {
            void handleSaveRole();
          }}
          onTogglePermission={togglePermission}
        />
      </div>

      <PermissionsRoleCatalogUnsavedModal
        open={unsavedModalOpen}
        loading={
          roleActionLoading?.kind === (isCreateMode ? 'create' : 'update')
        }
        onCancel={closeUnsavedModal}
        onDiscard={handleDiscardAndContinue}
        onSave={() => {
          void handleSaveAndContinue();
        }}
      />
    </>
  );
}
