import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Menu,
  Modal,
  Skeleton,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import CopyOutlined from '@ant-design/icons/CopyOutlined';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import type {
  WorkspacePermissionCatalogItem,
  WorkspaceRoleCatalogItem,
} from '@/features/settings/workspaceGovernanceShared';
import {
  buildCopiedWorkspaceRoleName,
  normalizeWorkspaceRoleNameInput,
  summarizePermissionDiff,
} from './permissionsPageUtils';
import type { WorkspaceRoleDraftPayload } from './usePermissionsCustomRoles';

const { Paragraph, Text } = Typography;
const { TabPane } = Tabs;

const EMPTY_ROLE_ID = '__create__';
const HIDDEN_PERMISSION_PREFIXES = [
  'access_review.',
  'break_glass.',
  'impersonation.',
];

const MODULE_DEFINITIONS = [
  {
    key: 'people',
    label: '用户与组织',
    match: (name: string) =>
      name.startsWith('workspace.member') ||
      name.startsWith('group.') ||
      name.startsWith('workspace.default') ||
      name === 'workspace.read',
  },
  {
    key: 'data',
    label: '知识库与连接',
    match: (name: string) =>
      name.startsWith('knowledge_base.') ||
      name.startsWith('connector.') ||
      name.startsWith('workspace.schedule') ||
      name.startsWith('dashboard.schedule'),
  },
  {
    key: 'runtime',
    label: '技能与运行时',
    match: (name: string) =>
      name.startsWith('skill.') ||
      name.startsWith('secret.') ||
      name.startsWith('service_account.') ||
      name.startsWith('api_token.'),
  },
  {
    key: 'security',
    label: '身份与审计',
    match: (name: string) =>
      name.startsWith('identity_provider.') ||
      name.startsWith('audit.') ||
      name.startsWith('role.'),
  },
  {
    key: 'other',
    label: '其他',
    match: (_name: string) => true,
  },
] as const;

type PermissionModuleKey = (typeof MODULE_DEFINITIONS)[number]['key'];

type RoleDraft = {
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  permissionNames: string[];
};

type PermissionGroup = {
  key: string;
  label: string;
  items: WorkspacePermissionCatalogItem[];
};

type EditorIntent =
  | { type: 'create' }
  | { type: 'select'; roleId: string }
  | { type: 'copy'; roleId: string }
  | { type: 'delete'; roleId: string }
  | { type: 'toggleStatus'; roleId: string; nextActive: boolean };

const EMPTY_ROLE_DRAFT: RoleDraft = {
  name: '',
  displayName: '',
  description: '',
  isActive: true,
  permissionNames: [],
};

const RESOURCE_LABELS: Record<string, string> = {
  workspace: '工作空间',
  'workspace.default': '默认工作空间',
  'workspace.member': '成员管理',
  'workspace.schedule': '工作空间计划',
  'dashboard.schedule': '数据看板计划',
  knowledge_base: '知识库',
  connector: '连接器',
  skill: '技能',
  secret: '密钥管理',
  service_account: '服务账号',
  api_token: 'API Token',
  identity_provider: '身份目录',
  audit: '审计日志',
  group: '目录组',
  role: '角色与权限',
};

const ACTION_LABELS: Record<string, string> = {
  read: '查看',
  create: '创建',
  update: '更新',
  delete: '删除',
  archive: '归档',
  invite: '邀请',
  approve: '批准',
  reject: '拒绝',
  remove: '移除',
  manage: '管理',
  revoke: '撤销',
  set: '设置',
  role: '角色',
  status: '状态',
  rotate_secret: '轮换密钥',
};

const ACTION_TAG_COLORS: Record<string, string> = {
  read: 'blue',
  create: 'green',
  update: 'gold',
  delete: 'red',
  archive: 'orange',
  invite: 'cyan',
  approve: 'green',
  reject: 'red',
  remove: 'volcano',
  manage: 'purple',
  revoke: 'magenta',
  set: 'geekblue',
  role: 'purple',
  status: 'cyan',
  rotate_secret: 'gold',
};

const COUNT_TAG_STYLE = {
  color: 'var(--ant-color-primary)',
  background: 'var(--ant-color-primary-bg)',
  borderColor: 'var(--ant-color-primary-border)',
  borderRadius: 999,
  fontWeight: 600,
} as const;

const PERMISSION_HEADLINE_OVERRIDES: Record<string, string> = {
  'workspace.read': '查看工作空间',
  'workspace.default.set': '设为默认工作空间',
  'workspace.member.invite': '邀请成员',
  'workspace.member.approve': '批准成员申请',
  'workspace.member.reject': '拒绝成员申请',
  'workspace.member.status.update': '更新成员状态',
  'workspace.member.remove': '移除成员',
  'workspace.member.role.update': '调整成员角色',
  'workspace.schedule.manage': '管理工作空间计划',
  'dashboard.schedule.manage': '管理看板计划',
  'knowledge_base.create': '创建知识库',
  'knowledge_base.read': '查看知识库',
  'knowledge_base.update': '编辑知识库',
  'knowledge_base.archive': '归档知识库',
  'connector.create': '创建连接器',
  'connector.read': '查看连接器',
  'connector.update': '编辑连接器',
  'connector.delete': '删除连接器',
  'connector.rotate_secret': '轮换连接密钥',
  'skill.create': '创建技能',
  'skill.read': '查看技能',
  'skill.update': '编辑技能',
  'skill.delete': '删除技能',
  'secret.reencrypt': '重新加密密钥',
  'service_account.read': '查看服务账号',
  'service_account.create': '创建服务账号',
  'service_account.update': '编辑服务账号',
  'service_account.delete': '删除服务账号',
  'api_token.read': '查看 API Token',
  'api_token.create': '创建 API Token',
  'api_token.revoke': '撤销 API Token',
  'identity_provider.read': '查看身份目录',
  'identity_provider.manage': '管理身份目录',
  'group.read': '查看目录组',
  'group.manage': '管理目录组',
  'audit.read': '查看审计日志',
  'role.read': '查看角色目录',
  'role.manage': '管理角色与权限',
};

const PERMISSION_DESCRIPTION_OVERRIDES: Record<string, string> = {
  'workspace.read': '查看当前工作空间的基础信息与元数据。',
  'workspace.default.set': '将当前工作空间设为个人默认工作空间。',
  'workspace.member.invite': '邀请成员加入当前工作空间。',
  'workspace.member.approve': '批准工作空间加入申请。',
  'workspace.member.reject': '拒绝工作空间加入申请。',
  'workspace.member.status.update': '更新工作空间成员的启停状态。',
  'workspace.member.remove': '将成员移出当前工作空间。',
  'workspace.member.role.update': '调整成员在当前工作空间中的角色。',
  'workspace.schedule.manage': '管理工作空间级计划与自动化任务。',
  'dashboard.schedule.manage': '管理数据看板的计划任务。',
  'knowledge_base.create': '创建新的空间知识库。',
  'knowledge_base.read': '查看知识库详情与内容。',
  'knowledge_base.update': '更新知识库信息与配置。',
  'knowledge_base.archive': '归档或恢复知识库。',
  'connector.create': '创建新的数据连接器。',
  'connector.read': '查看连接器详情与配置。',
  'connector.update': '编辑连接器配置。',
  'connector.delete': '删除连接器。',
  'connector.rotate_secret': '轮换或替换连接器密钥。',
  'skill.create': '创建新的技能。',
  'skill.read': '查看技能详情。',
  'skill.update': '更新技能配置。',
  'skill.delete': '删除技能。',
  'secret.reencrypt': '重新加密工作空间密钥。',
  'service_account.read': '查看服务账号详情。',
  'service_account.create': '创建服务账号。',
  'service_account.update': '更新服务账号配置。',
  'service_account.delete': '删除服务账号。',
  'api_token.read': '查看 API Token 元数据。',
  'api_token.create': '创建新的 API Token。',
  'api_token.revoke': '撤销已有 API Token。',
  'identity_provider.read': '查看身份目录设置。',
  'identity_provider.manage': '管理身份目录接入与配置。',
  'group.read': '查看目录组与绑定关系。',
  'group.manage': '管理目录组及其角色绑定。',
  'audit.read': '查看工作空间审计日志。',
  'role.read': '查看角色目录与绑定情况。',
  'role.manage': '管理角色与权限配置。',
};

const buildRoleDraftFromRole = (role: WorkspaceRoleCatalogItem): RoleDraft => ({
  name: role.name || '',
  displayName: role.displayName || '',
  description: role.description || '',
  isActive: role.isActive !== false,
  permissionNames: Array.from(new Set(role.permissionNames || [])).sort(),
});

const normalizePermissionNames = (permissionNames: string[]) =>
  Array.from(
    new Set(
      (permissionNames || [])
        .map((name) => String(name || '').trim())
        .filter(Boolean),
    ),
  ).sort();

const isDraftEqual = (left: RoleDraft, right: RoleDraft) =>
  normalizeWorkspaceRoleNameInput(left.name) ===
    normalizeWorkspaceRoleNameInput(right.name) &&
  left.displayName.trim() === right.displayName.trim() &&
  left.description.trim() === right.description.trim() &&
  Boolean(left.isActive) === Boolean(right.isActive) &&
  JSON.stringify(normalizePermissionNames(left.permissionNames)) ===
    JSON.stringify(normalizePermissionNames(right.permissionNames));

const matchesRoleKeyword = (
  role: WorkspaceRoleCatalogItem,
  keyword: string,
): boolean => {
  if (!keyword) {
    return true;
  }

  const source = [role.displayName, role.name, role.description || '']
    .join(' ')
    .toLowerCase();
  return source.includes(keyword);
};

const shouldHidePermission = (permissionName: string) =>
  HIDDEN_PERMISSION_PREFIXES.some((prefix) =>
    permissionName.startsWith(prefix),
  );

const getModuleKey = (name: string): PermissionModuleKey => {
  const matched = MODULE_DEFINITIONS.find((module, index) =>
    index === MODULE_DEFINITIONS.length - 1 ? false : module.match(name),
  );
  return matched?.key || 'other';
};

const getResourceKey = (permissionName: string) => {
  if (permissionName.endsWith('.role.update')) {
    return permissionName.slice(0, -'.role.update'.length);
  }
  if (permissionName.endsWith('.status.update')) {
    return permissionName.slice(0, -'.status.update'.length);
  }
  const segments = permissionName.split('.');
  if (segments.length <= 2) {
    return segments[0] || permissionName;
  }
  return segments.slice(0, -1).join('.');
};

const getResourceLabel = (resourceKey: string) =>
  RESOURCE_LABELS[resourceKey] || resourceKey.replace(/[_\.]+/g, ' ');

const getActionDescriptor = (permissionName: string) => {
  const segments = permissionName.split('.');
  if (permissionName.endsWith('.role.update')) {
    return { key: 'role', label: '调整角色' };
  }
  if (permissionName.endsWith('.status.update')) {
    return { key: 'status', label: '更新状态' };
  }
  if (permissionName.endsWith('.default.set')) {
    return { key: 'set', label: '设置默认' };
  }
  const actionKey = segments[segments.length - 1] || permissionName;
  return {
    key: actionKey,
    label: ACTION_LABELS[actionKey] || actionKey,
  };
};

const getPermissionHeadline = (permissionName: string) => {
  if (PERMISSION_HEADLINE_OVERRIDES[permissionName]) {
    return PERMISSION_HEADLINE_OVERRIDES[permissionName];
  }
  const resourceKey = getResourceKey(permissionName);
  const resourceLabel = getResourceLabel(resourceKey);
  const action = getActionDescriptor(permissionName);
  if (action.label === '管理') {
    return `管理${resourceLabel}`;
  }
  if (action.label === '查看') {
    return `查看${resourceLabel}`;
  }
  return `${action.label}${resourceLabel}`;
};

const getPermissionDescription = (permission: WorkspacePermissionCatalogItem) =>
  PERMISSION_DESCRIPTION_OVERRIDES[permission.name] ||
  permission.description ||
  '暂无权限说明';

const renderReadonlyField = ({
  value,
  fallback = '--',
  minWidth,
}: {
  value?: string | null;
  fallback?: string;
  minWidth: number;
}) => (
  <div
    style={{
      height: 32,
      minWidth,
      display: 'flex',
      alignItems: 'center',
      paddingInline: 11,
      borderRadius: 6,
      border: '1px solid var(--ant-color-border)',
      background: 'var(--ant-color-bg-container-disabled)',
    }}
  >
    <Text ellipsis style={{ maxWidth: minWidth + 80 }}>
      {value?.trim() || fallback}
    </Text>
  </div>
);

const buildRolePayload = ({
  draft,
  includeMetadata,
}: {
  draft: RoleDraft;
  includeMetadata: boolean;
}): WorkspaceRoleDraftPayload => {
  const normalizedName = normalizeWorkspaceRoleNameInput(draft.name);
  const normalizedDisplayName = draft.displayName.trim() || draft.name.trim();

  return {
    ...(includeMetadata && normalizedName ? { name: normalizedName } : {}),
    ...(includeMetadata ? { displayName: normalizedDisplayName } : {}),
    ...(includeMetadata
      ? {
          description: draft.description.trim() || null,
          isActive: draft.isActive,
        }
      : {}),
    permissionNames: normalizePermissionNames(draft.permissionNames),
  };
};

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
  const [pendingIntent, setPendingIntent] = useState<EditorIntent | null>(null);
  const [unsavedModalOpen, setUnsavedModalOpen] = useState(false);

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

      const selectedCount = items.filter((permission) =>
        selectedPermissionSet.has(permission.name),
      ).length;

      return {
        ...module,
        items,
        selectedCount,
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
      const resourceKey = getResourceKey(permission.name);
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

  const handleSaveRole = async () => {
    const includeMetadata = isCreateMode || !isSystemRole;
    const payload = buildRolePayload({ draft, includeMetadata });
    if (isCreateMode) {
      if (!payload.name) {
        return false;
      }
      const createdRoleId = await onCreateCustomRole(payload);
      if (createdRoleId) {
        setSelectedRoleId(createdRoleId);
        return true;
      }
      return false;
    }

    if (!selectedRole) {
      return false;
    }

    return Boolean(await onUpdateCustomRole(selectedRole.id, payload));
  };

  const performIntent = async (intent: EditorIntent) => {
    if (intent.type === 'create') {
      setSelectedRoleId(EMPTY_ROLE_ID);
      setDraft(EMPTY_ROLE_DRAFT);
      resetFilters();
      return;
    }

    if (intent.type === 'select') {
      if (selectedRoleId === intent.roleId && !isCreateMode) {
        return;
      }
      setSelectedRoleId(intent.roleId);
      resetFilters();
      return;
    }

    const targetRole = roleCatalog.find((role) => role.id === intent.roleId);
    if (!targetRole) {
      return;
    }

    if (intent.type === 'copy') {
      setSelectedRoleId(EMPTY_ROLE_ID);
      setDraft({
        name: buildCopiedWorkspaceRoleName({
          sourceName: targetRole.name,
          existingNames: roleCatalog.map((role) => role.name),
        }),
        displayName: `${targetRole.displayName || targetRole.name} 副本`,
        description: targetRole.description || '',
        isActive: targetRole.isActive !== false,
        permissionNames: normalizePermissionNames(targetRole.permissionNames),
      });
      resetFilters();
      return;
    }

    if (intent.type === 'delete') {
      const deleted = await onDeleteCustomRole(targetRole.id);
      if (deleted && selectedRoleId === targetRole.id) {
        setSelectedRoleId(null);
      }
      return;
    }

    if (intent.type === 'toggleStatus') {
      await onUpdateCustomRole(targetRole.id, {
        name: targetRole.name,
        displayName: targetRole.displayName,
        description: targetRole.description || null,
        isActive: intent.nextActive,
        permissionNames: targetRole.permissionNames,
      });
    }
  };

  const requestIntent = (intent: EditorIntent) => {
    if (!isDirty) {
      void performIntent(intent);
      return;
    }
    setPendingIntent(intent);
    setUnsavedModalOpen(true);
  };

  const handleDiscardAndContinue = () => {
    if (pendingIntent) {
      void performIntent(pendingIntent);
    }
    setPendingIntent(null);
    setUnsavedModalOpen(false);
  };

  const handleSaveAndContinue = async () => {
    const success = await handleSaveRole();
    if (!success) {
      return;
    }
    if (pendingIntent) {
      await performIntent(pendingIntent);
    }
    setPendingIntent(null);
    setUnsavedModalOpen(false);
  };

  const roleMenuItems = (role: WorkspaceRoleCatalogItem) => {
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
    ? !canManageRoles ||
      !normalizeWorkspaceRoleNameInput(draft.name) ||
      !isDirty
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
    children: null,
  }));

  return !canReadRoles ? (
    <Alert
      type="info"
      showIcon
      message="当前为只读提示"
      description="你没有 role.read 权限，暂时无法查看角色目录。"
    />
  ) : (
    <>
      <div
        style={{
          display: 'flex',
          gap: 10,
          minHeight: 720,
          alignItems: 'stretch',
        }}
      >
        <Card
          size="small"
          style={{ width: 286, flexShrink: 0 }}
          bodyStyle={{
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <Text strong style={{ fontSize: 16 }}>
              角色列表
            </Text>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManageRoles}
              onClick={() => requestIntent({ type: 'create' })}
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

          <div style={{ flex: 1, overflow: 'auto', paddingRight: 4 }}>
            {roleCatalogLoading ? (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Card size="small">
                  <Skeleton active title={false} paragraph={{ rows: 2 }} />
                </Card>
                <Card size="small">
                  <Skeleton active title={false} paragraph={{ rows: 2 }} />
                </Card>
                <Card size="small">
                  <Skeleton active title={false} paragraph={{ rows: 2 }} />
                </Card>
              </Space>
            ) : visibleRoles.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无匹配角色"
              />
            ) : (
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {visibleRoles.map((role) => {
                  const selected = selectedRoleId === role.id && !isCreateMode;
                  const deleting =
                    roleActionLoading?.kind === 'delete' &&
                    roleActionLoading.roleId === role.id;
                  return (
                    <div
                      key={role.id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        requestIntent({ type: 'select', roleId: role.id })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          requestIntent({ type: 'select', roleId: role.id });
                        }
                      }}
                      style={{
                        border: selected
                          ? '1px solid var(--ant-color-primary-border)'
                          : '1px solid var(--ant-color-border-secondary)',
                        borderRadius: 8,
                        padding: '8px 8px 8px 10px',
                        cursor: 'pointer',
                        background: selected
                          ? 'rgba(22, 119, 255, 0.14)'
                          : 'var(--ant-color-bg-container)',
                        borderInlineStart: selected
                          ? '3px solid var(--ant-color-primary)'
                          : '3px solid transparent',
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
                          gap: 8,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <Space size={4} wrap>
                            <Text strong ellipsis style={{ maxWidth: 150 }}>
                              {role.displayName || role.name}
                            </Text>
                            <Tag color={role.isSystem ? 'gold' : 'blue'}>
                              {role.isSystem ? '系统' : '自定义'}
                            </Tag>
                          </Space>
                          <div
                            style={{
                              marginTop: 2,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              flexWrap: 'wrap',
                            }}
                          >
                            <Space size={[8, 4]} wrap>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {role.name}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                权限 {role.permissionNames.length}
                              </Text>
                              <Badge
                                status={
                                  role.isActive === false
                                    ? 'default'
                                    : 'success'
                                }
                                text={role.isActive === false ? '停用' : '启用'}
                              />
                            </Space>
                          </div>
                        </div>
                        <Dropdown
                          trigger={['click']}
                          overlay={
                            <Menu>
                              {roleMenuItems(role).map((item: any) => (
                                <Menu.Item
                                  key={item.key}
                                  icon={item.icon}
                                  danger={item.danger}
                                  disabled={item.disabled}
                                  onClick={item.onClick}
                                >
                                  {item.label}
                                </Menu.Item>
                              ))}
                            </Menu>
                          }
                        >
                          <Button
                            type="text"
                            icon={<MoreOutlined />}
                            loading={deleting}
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
          style={{ flex: 1, minWidth: 0 }}
          bodyStyle={{
            padding: '8px 8px 4px',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            height: '100%',
          }}
        >
          {!selectedRole && !isCreateMode ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                roleCatalogLoading
                  ? '正在加载角色目录…'
                  : '请选择左侧角色查看详情'
              }
            />
          ) : (
            <>
              <div
                style={{
                  borderBottom: '1px solid var(--ant-color-border-secondary)',
                  paddingBottom: 8,
                  marginBottom: 8,
                }}
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
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      flexWrap: 'wrap',
                      flex: 1,
                      minWidth: 280,
                    }}
                  >
                    <Space size={6} align="center" wrap>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        角色标识
                      </Text>
                      {metadataReadOnly && !isCreateMode ? (
                        renderReadonlyField({
                          value: draft.name,
                          minWidth: 188,
                        })
                      ) : (
                        <Input
                          style={{ width: 188 }}
                          value={draft.name}
                          disabled={!canManageRoles || isSystemRole}
                          placeholder="例如：finance_admin"
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              name: normalizeWorkspaceRoleNameInput(
                                event.target.value,
                              ),
                            }))
                          }
                        />
                      )}
                    </Space>
                    <Space size={6} align="center" wrap>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        角色名称
                      </Text>
                      {metadataReadOnly && !isCreateMode ? (
                        renderReadonlyField({
                          value: draft.displayName || draft.name,
                          minWidth: 208,
                        })
                      ) : (
                        <Input
                          style={{ width: 208 }}
                          value={draft.displayName}
                          disabled={metadataReadOnly}
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
                  </div>

                  <Space size={8} wrap>
                    <Space size={8} align="center">
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        启用状态
                      </Text>
                      <Switch
                        checked={draft.isActive}
                        disabled={metadataReadOnly}
                        onChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            isActive: checked,
                          }))
                        }
                      />
                    </Space>
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
                      loading={
                        roleActionLoading?.kind ===
                          (isCreateMode ? 'create' : 'update') &&
                        (isCreateMode ||
                          roleActionLoading.roleId === selectedRole?.id)
                      }
                      onClick={() => {
                        void handleSaveRole();
                      }}
                    >
                      {isCreateMode ? '新建角色' : '保存变更'}
                    </Button>
                  </Space>
                </div>

                <Space
                  direction="vertical"
                  size={6}
                  style={{ width: '100%', marginTop: 10 }}
                >
                  {isSystemRole ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      系统角色仅允许修改权限，不允许修改角色标识、名称和启用状态。
                    </Text>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      自定义角色支持调整角色标识、名称、启用状态与权限配置。
                    </Text>
                  )}
                  {!metadataReadOnly || isCreateMode ? (
                    <Input
                      value={draft.description}
                      placeholder="角色说明（可选）"
                      disabled={metadataReadOnly}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  ) : null}
                </Space>
              </div>

              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  background: 'var(--ant-color-bg-container)',
                  borderBottom: '1px solid var(--ant-color-border-secondary)',
                  marginBottom: 8,
                }}
              >
                <Tabs
                  size="small"
                  activeKey={activeModule?.key}
                  onChange={(key) =>
                    setActiveModuleKey(key as PermissionModuleKey)
                  }
                  style={{ marginBottom: 0, paddingTop: 2 }}
                >
                  {tabsItems.map((item) => (
                    <TabPane tab={item.label} key={item.key} />
                  ))}
                </Tabs>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '4px 8px',
                    border: '1px solid var(--ant-color-border-secondary)',
                    borderRadius: 8,
                    background: 'var(--ant-color-fill-quaternary)',
                  }}
                >
                  <Space size={[10, 8]} wrap>
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
                        onChange={setOnlyShowSelected}
                      />
                      <Text type="secondary">仅看已选</Text>
                    </Space>
                  </Space>

                  <Space size={8} wrap>
                    <Dropdown
                      trigger={['click']}
                      overlay={
                        <Menu>
                          <Menu.Item
                            key="select-module"
                            disabled={
                              permissionReadOnly ||
                              activeModulePermissionNames.length === 0
                            }
                            onClick={() => mutateModuleSelection(true)}
                          >
                            全选本模块
                          </Menu.Item>
                          <Menu.Item
                            key="clear-module"
                            disabled={
                              permissionReadOnly ||
                              activeModulePermissionNames.length === 0
                            }
                            onClick={() => mutateModuleSelection(false)}
                          >
                            清空本模块
                          </Menu.Item>
                        </Menu>
                      }
                    >
                      <Button
                        icon={<MoreOutlined />}
                        disabled={activeModulePermissionNames.length === 0}
                      >
                        模块操作
                      </Button>
                    </Dropdown>
                    <Button
                      disabled={!permissionKeyword && !onlyShowSelected}
                      onClick={() => {
                        setPermissionKeyword('');
                        setOnlyShowSelected(false);
                      }}
                    >
                      清空筛选
                    </Button>
                  </Space>
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  minHeight: 420,
                  overflow: 'auto',
                  paddingRight: 4,
                  paddingBottom: 112,
                }}
              >
                {roleCatalogLoading ? (
                  <Space
                    direction="vertical"
                    size={10}
                    style={{ width: '100%' }}
                  >
                    <Card size="small">
                      <Skeleton active paragraph={{ rows: 2 }} title={false} />
                    </Card>
                    <Card size="small">
                      <Skeleton active paragraph={{ rows: 2 }} title={false} />
                    </Card>
                  </Space>
                ) : permissionGroups.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前筛选下暂无权限"
                  />
                ) : (
                  <Space
                    direction="vertical"
                    size={8}
                    style={{ width: '100%' }}
                  >
                    {permissionGroups.map((group) => {
                      const selectedCount = group.items.filter((permission) =>
                        selectedPermissionSet.has(permission.name),
                      ).length;
                      const assignablePermissionNames = group.items
                        .filter((permission) => permission.assignable)
                        .map((permission) => permission.name);
                      return (
                        <Card
                          size="small"
                          key={group.key}
                          title={
                            <Space size={8}>
                              <Text strong>{group.label}</Text>
                              <Tag style={COUNT_TAG_STYLE}>
                                {selectedCount}/{group.items.length}
                              </Tag>
                            </Space>
                          }
                          extra={
                            <Dropdown
                              trigger={['click']}
                              overlay={
                                <Menu>
                                  <Menu.Item
                                    key={`${group.key}-select`}
                                    disabled={
                                      permissionReadOnly ||
                                      assignablePermissionNames.length === 0
                                    }
                                    onClick={() =>
                                      mutateGroupSelection(
                                        assignablePermissionNames,
                                        'select',
                                      )
                                    }
                                  >
                                    全选
                                  </Menu.Item>
                                  <Menu.Item
                                    key={`${group.key}-clear`}
                                    disabled={
                                      permissionReadOnly ||
                                      assignablePermissionNames.length === 0
                                    }
                                    onClick={() =>
                                      mutateGroupSelection(
                                        assignablePermissionNames,
                                        'clear',
                                      )
                                    }
                                  >
                                    清空
                                  </Menu.Item>
                                  <Menu.Item
                                    key={`${group.key}-invert`}
                                    disabled={
                                      permissionReadOnly ||
                                      assignablePermissionNames.length === 0
                                    }
                                    onClick={() =>
                                      mutateGroupSelection(
                                        assignablePermissionNames,
                                        'invert',
                                      )
                                    }
                                  >
                                    反选
                                  </Menu.Item>
                                </Menu>
                              }
                            >
                              <Button type="text" icon={<MoreOutlined />}>
                                更多
                              </Button>
                            </Dropdown>
                          }
                          bodyStyle={{ padding: 8 }}
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
                              const disabled =
                                permissionReadOnly || !permission.assignable;
                              return (
                                <label
                                  key={permission.name}
                                  style={{
                                    minHeight: 80,
                                    border: checked
                                      ? '1px solid var(--ant-color-primary)'
                                      : '1px solid var(--ant-color-border-secondary)',
                                    borderRadius: 8,
                                    padding: '6px 7px',
                                    background: 'var(--ant-color-bg-container)',
                                    cursor: disabled ? 'default' : 'pointer',
                                    display: 'flex',
                                    gap: 7,
                                    alignItems: 'flex-start',
                                    opacity: disabled && !checked ? 0.72 : 1,
                                    boxShadow: checked
                                      ? '0 0 0 1px rgba(22, 119, 255, 0.08) inset'
                                      : 'none',
                                  }}
                                >
                                  <Checkbox
                                    checked={checked}
                                    disabled={disabled}
                                    onChange={(event) =>
                                      togglePermission(
                                        permission.name,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <Space size={[4, 4]} wrap>
                                      <Tag
                                        color={
                                          ACTION_TAG_COLORS[action.key] ||
                                          'blue'
                                        }
                                      >
                                        {action.label}
                                      </Tag>
                                      <Text
                                        strong
                                        style={{ maxWidth: 140 }}
                                        ellipsis
                                      >
                                        {getPermissionHeadline(permission.name)}
                                      </Text>
                                      {!permission.assignable ? (
                                        <Tag>系统保留</Tag>
                                      ) : null}
                                    </Space>
                                    <div style={{ marginTop: 6 }}>
                                      <Text
                                        type="secondary"
                                        style={{
                                          fontSize: 12,
                                          maxWidth: 180,
                                          lineHeight: 1.35,
                                        }}
                                        ellipsis={{ tooltip: permission.name }}
                                      >
                                        {permission.name}
                                      </Text>
                                    </div>
                                    <Paragraph
                                      type="secondary"
                                      style={{
                                        marginBottom: 0,
                                        marginTop: 0,
                                        fontSize: 12,
                                        lineHeight: 1.35,
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

              <div
                style={{
                  marginTop: 'auto',
                  borderTop: '1px solid var(--ant-color-border-secondary)',
                  paddingTop: 8,
                  paddingInline: 2,
                  position: 'sticky',
                  bottom: 0,
                  background: 'var(--ant-color-bg-container)',
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <Space size={8} wrap>
                    <Text type={isDirty ? 'warning' : 'secondary'}>
                      {footerStatusText}
                    </Text>
                    {roleCatalogLoading ? (
                      <Tag color="default">同步中...</Tag>
                    ) : null}
                  </Space>
                  <Space size={8}>
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
                      loading={
                        roleActionLoading?.kind ===
                          (isCreateMode ? 'create' : 'update') &&
                        (isCreateMode ||
                          roleActionLoading.roleId === selectedRole?.id)
                      }
                      onClick={() => {
                        void handleSaveRole();
                      }}
                    >
                      保存变更
                    </Button>
                  </Space>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <Modal
        visible={unsavedModalOpen}
        title="有未保存改动"
        onCancel={() => {
          setUnsavedModalOpen(false);
          setPendingIntent(null);
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setUnsavedModalOpen(false);
              setPendingIntent(null);
            }}
          >
            取消
          </Button>,
          <Button key="discard" onClick={handleDiscardAndContinue}>
            放弃并继续
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={
              roleActionLoading?.kind === (isCreateMode ? 'create' : 'update')
            }
            onClick={() => {
              void handleSaveAndContinue();
            }}
          >
            保存并继续
          </Button>,
        ]}
      >
        <Text type="secondary">当前编辑内容尚未保存，是否先保存后再继续？</Text>
      </Modal>
    </>
  );
}
