import type { ReactNode } from 'react';
import type {
  WorkspacePermissionCatalogItem,
  WorkspaceRoleCatalogItem,
} from '@/features/settings/workspaceGovernanceShared';
import { normalizeWorkspaceRoleNameInput } from './permissionsPageUtils';
import type { WorkspaceRoleDraftPayload } from './usePermissionsCustomRoles';

export const EMPTY_ROLE_ID = '__create__';
const HIDDEN_PERMISSION_PREFIXES = [
  'access_review.',
  'break_glass.',
  'impersonation.',
];

export const MODULE_DEFINITIONS = [
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

export type PermissionModuleKey = (typeof MODULE_DEFINITIONS)[number]['key'];

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
  items: WorkspacePermissionCatalogItem[];
};

export type PermissionModuleSummary = (typeof MODULE_DEFINITIONS)[number] & {
  items: WorkspacePermissionCatalogItem[];
  selectedCount: number;
};

export type EditorIntent =
  | { type: 'create' }
  | { type: 'select'; roleId: string }
  | { type: 'copy'; roleId: string }
  | { type: 'delete'; roleId: string }
  | { type: 'toggleStatus'; roleId: string; nextActive: boolean };

export type RoleMenuItem = {
  key: string;
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
};

export const EMPTY_ROLE_DRAFT: RoleDraft = {
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

export const ACTION_TAG_COLORS: Record<string, string> = {
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

export const COUNT_TAG_STYLE = {
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

export const buildRoleDraftFromRole = (
  role: WorkspaceRoleCatalogItem,
): RoleDraft => ({
  name: role.name || '',
  displayName: role.displayName || '',
  description: role.description || '',
  isActive: role.isActive !== false,
  permissionNames: Array.from(new Set(role.permissionNames || [])).sort(),
});

export const normalizePermissionNames = (permissionNames: string[]) =>
  Array.from(
    new Set(
      (permissionNames || [])
        .map((name) => String(name || '').trim())
        .filter(Boolean),
    ),
  ).sort();

export const isDraftEqual = (left: RoleDraft, right: RoleDraft) =>
  normalizeWorkspaceRoleNameInput(left.name) ===
    normalizeWorkspaceRoleNameInput(right.name) &&
  left.displayName.trim() === right.displayName.trim() &&
  left.description.trim() === right.description.trim() &&
  Boolean(left.isActive) === Boolean(right.isActive) &&
  JSON.stringify(normalizePermissionNames(left.permissionNames)) ===
    JSON.stringify(normalizePermissionNames(right.permissionNames));

export const matchesRoleKeyword = (
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

export const shouldHidePermission = (permissionName: string) =>
  HIDDEN_PERMISSION_PREFIXES.some((prefix) =>
    permissionName.startsWith(prefix),
  );

export const getModuleKey = (name: string): PermissionModuleKey => {
  const matched = MODULE_DEFINITIONS.find((module, index) =>
    index === MODULE_DEFINITIONS.length - 1 ? false : module.match(name),
  );
  return matched?.key || 'other';
};

export const getPermissionResourceKey = (permissionName: string) => {
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

export const getResourceLabel = (resourceKey: string) =>
  RESOURCE_LABELS[resourceKey] || resourceKey.replace(/[_\.]+/g, ' ');

export const getActionDescriptor = (permissionName: string) => {
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

export const getPermissionHeadline = (permissionName: string) => {
  if (PERMISSION_HEADLINE_OVERRIDES[permissionName]) {
    return PERMISSION_HEADLINE_OVERRIDES[permissionName];
  }
  const resourceKey = getPermissionResourceKey(permissionName);
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

export const getPermissionDescription = (
  permission: WorkspacePermissionCatalogItem,
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
