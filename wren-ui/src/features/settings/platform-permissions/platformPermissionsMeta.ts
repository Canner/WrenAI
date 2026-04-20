export type PlatformPermissionCatalogItem = {
  name: string;
  description: string;
  scope: 'platform';
};

export type PlatformRoleCatalogItem = {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  scopeType: string;
  scopeId?: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionNames: string[];
  bindingCount: number;
};

export const EMPTY_ROLE_ID = '__create__';

export const PLATFORM_PERMISSION_MODULES = [
  {
    key: 'user',
    label: '用户目录',
    match: (name: string) => name.startsWith('platform.user.'),
  },
  {
    key: 'role',
    label: '角色与权限',
    match: (name: string) => name.startsWith('platform.role.'),
  },
  {
    key: 'workspace',
    label: '空间治理',
    match: (name: string) =>
      name === 'workspace.create' || name.startsWith('platform.workspace.'),
  },
  {
    key: 'observability',
    label: '审计与运维',
    match: (name: string) =>
      name.startsWith('platform.audit.') ||
      name.startsWith('platform.diagnostics.') ||
      name.startsWith('platform.system_task.'),
  },
  {
    key: 'security',
    label: '安全与审计',
    match: (name: string) =>
      name.startsWith('break_glass.') || name.startsWith('impersonation.'),
  },
  {
    key: 'other',
    label: '其他',
    match: (_name: string) => true,
  },
] as const;

export type PlatformPermissionModuleKey =
  (typeof PLATFORM_PERMISSION_MODULES)[number]['key'];

export type RoleDraft = {
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  permissionNames: string[];
};

export type PermissionGroup = {
  key: string;
  label: string;
  items: PlatformPermissionCatalogItem[];
};

export type PermissionModuleSummary =
  (typeof PLATFORM_PERMISSION_MODULES)[number] & {
    items: PlatformPermissionCatalogItem[];
    selectedCount: number;
  };

export const EMPTY_ROLE_DRAFT: RoleDraft = {
  name: '',
  displayName: '',
  description: '',
  isActive: true,
  permissionNames: [],
};

const RESOURCE_LABELS: Record<string, string> = {
  'platform.user': '平台用户',
  'platform.user.role': '平台用户角色',
  'platform.user.workspace': '平台用户工作空间',
  'platform.role': '平台角色',
  'platform.workspace': '平台工作空间',
  'platform.audit': '平台审计日志',
  'platform.diagnostics': '平台调用诊断',
  'platform.system_task': '平台系统任务',
  workspace: '工作空间',
  break_glass: 'Break Glass',
  impersonation: '身份模拟',
};

const ACTION_LABELS: Record<string, string> = {
  read: '查看',
  create: '创建',
  update: '编辑',
  delete: '删除',
  assign: '分配',
  manage: '管理',
  start: '发起',
};

export const ACTION_TAG_COLORS: Record<string, string> = {
  read: 'blue',
  create: 'green',
  update: 'gold',
  delete: 'red',
  assign: 'cyan',
  manage: 'purple',
  start: 'cyan',
};

const PERMISSION_HEADLINE_OVERRIDES: Record<string, string> = {
  'platform.user.read': '查看平台用户',
  'platform.user.create': '新增平台用户',
  'platform.user.update': '编辑平台用户',
  'platform.user.role.assign': '分配平台角色',
  'platform.user.workspace.assign': '分配用户工作空间',
  'platform.role.read': '查看平台角色',
  'platform.role.create': '新增平台角色',
  'platform.role.update': '编辑平台角色',
  'platform.role.delete': '删除平台角色',
  'platform.workspace.read': '查看工作空间治理',
  'workspace.create': '创建工作空间',
  'platform.workspace.member.manage': '管理空间成员',
  'break_glass.manage': '管理紧急授权',
  'impersonation.start': '发起身份模拟',
  'platform.audit.read': '查看平台审计日志',
  'platform.diagnostics.read': '查看调用诊断',
  'platform.system_task.read': '查看系统任务',
  'platform.system_task.manage': '管理系统任务',
};

const PERMISSION_DESCRIPTION_OVERRIDES: Record<string, string> = {
  'platform.user.read': '允许查看平台用户目录、平台角色标签与默认工作空间信息。',
  'platform.user.create': '允许在平台控制台中新增本地用户账号。',
  'platform.user.update': '允许编辑用户基本资料与默认工作空间。',
  'platform.user.role.assign': '允许为用户分配或移除平台角色。',
  'platform.user.workspace.assign':
    '允许从平台侧分配用户所属工作空间并调整其空间身份。',
  'platform.role.read': '允许查看平台角色目录、绑定数量与权限矩阵。',
  'platform.role.create': '允许创建新的平台角色。',
  'platform.role.update': '允许编辑已有平台角色的元数据和权限项。',
  'platform.role.delete': '允许删除自定义平台角色。',
  'platform.workspace.read':
    '允许从平台控制台查看所有工作空间、成员概览与审批数据。',
  'workspace.create': '允许创建新的工作空间，并指定初始 owner。',
  'platform.workspace.member.manage':
    '允许从平台控制台调整工作空间成员、审批与角色。',
  'break_glass.manage': '允许处理 Break Glass 紧急提权与审计治理。',
  'impersonation.start': '允许发起受审计的身份模拟会话。',
  'platform.audit.read': '允许查看平台级审计日志。',
  'platform.diagnostics.read': '允许查看平台级调用诊断信息。',
  'platform.system_task.read': '允许查看平台系统任务状态。',
  'platform.system_task.manage': '允许执行平台系统任务管理动作。',
};

export const normalizeRoleNameInput = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

export const normalizePermissionNames = (permissionNames: string[]) =>
  Array.from(
    new Set(
      (permissionNames || [])
        .map((name) => String(name || '').trim())
        .filter(Boolean),
    ),
  ).sort();

export const isDraftEqual = (left: RoleDraft, right: RoleDraft) =>
  normalizeRoleNameInput(left.name) === normalizeRoleNameInput(right.name) &&
  left.displayName.trim() === right.displayName.trim() &&
  left.description.trim() === right.description.trim() &&
  Boolean(left.isActive) === Boolean(right.isActive) &&
  JSON.stringify(normalizePermissionNames(left.permissionNames)) ===
    JSON.stringify(normalizePermissionNames(right.permissionNames));

export const buildRoleDraftFromRole = (role: PlatformRoleCatalogItem): RoleDraft => ({
  name: role.name || '',
  displayName: role.displayName || '',
  description: role.description || '',
  isActive: role.isActive !== false,
  permissionNames: normalizePermissionNames(role.permissionNames || []),
});

export const matchesRoleKeyword = (
  role: PlatformRoleCatalogItem,
  keyword: string,
) => {
  if (!keyword) {
    return true;
  }
  const source = [role.displayName, role.name, role.description || '']
    .join(' ')
    .toLowerCase();
  return source.includes(keyword);
};

export const getModuleKey = (
  permissionName: string,
): PlatformPermissionModuleKey => {
  const matched = PLATFORM_PERMISSION_MODULES.find((module, index) =>
    index === PLATFORM_PERMISSION_MODULES.length - 1
      ? false
      : module.match(permissionName),
  );
  return matched?.key || 'other';
};

export const getPermissionResourceKey = (permissionName: string) => {
  const segments = permissionName.split('.');
  if (segments.length <= 1) {
    return permissionName;
  }
  return segments.slice(0, -1).join('.');
};

export const getResourceLabel = (resourceKey: string) =>
  RESOURCE_LABELS[resourceKey] || resourceKey.replace(/[_.]+/g, ' ');

export const getActionDescriptor = (permissionName: string) => {
  const segments = permissionName.split('.');
  const actionKey = segments[segments.length - 1] || permissionName;
  return {
    key: actionKey,
    label: ACTION_LABELS[actionKey] || actionKey,
  };
};

export const getPermissionHeadline = (permissionName: string) => {
  if (PERMISSION_HEADLINE_OVERRIDES[permissionName]) {
    return PERMISSION_HEADLINE_OVERRIDES[permissionName];
  }
  const resourceLabel = getResourceLabel(getPermissionResourceKey(permissionName));
  const action = getActionDescriptor(permissionName);
  return `${action.label}${resourceLabel}`;
};

export const getPermissionDescription = (
  permission: PlatformPermissionCatalogItem,
) =>
  PERMISSION_DESCRIPTION_OVERRIDES[permission.name] ||
  permission.description ||
  '暂无权限说明';

export const buildRolePayload = ({
  draft,
  includeMetadata,
}: {
  draft: RoleDraft;
  includeMetadata: boolean;
}) => {
  const normalizedName = normalizeRoleNameInput(draft.name);
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
