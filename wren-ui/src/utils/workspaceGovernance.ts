export const WORKSPACE_KINDS = {
  DEFAULT: 'default',
  REGULAR: 'regular',
} as const;

export type WorkspaceKind =
  (typeof WORKSPACE_KINDS)[keyof typeof WORKSPACE_KINDS];

export const KNOWLEDGE_BASE_KINDS = {
  REGULAR: 'regular',
  SYSTEM_SAMPLE: 'system_sample',
} as const;

export type KnowledgeBaseKind =
  (typeof KNOWLEDGE_BASE_KINDS)[keyof typeof KNOWLEDGE_BASE_KINDS];

export const DEFAULT_WORKSPACE_NAME = '系统样例空间';
export const DEFAULT_WORKSPACE_SLUG = 'system-samples';

export const WORKSPACE_MEMBER_ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  viewer: '查看者',
};

export const WORKSPACE_MEMBER_ROLE_OPTIONS = [
  { label: WORKSPACE_MEMBER_ROLE_LABELS.owner, value: 'owner' },
  { label: WORKSPACE_MEMBER_ROLE_LABELS.viewer, value: 'viewer' },
] as const;

export type WorkspaceMemberUiRoleKey =
  (typeof WORKSPACE_MEMBER_ROLE_OPTIONS)[number]['value'];

const WORKSPACE_ROLE_DISPLAY_ALIASES: Record<string, WorkspaceMemberUiRoleKey> =
  {
    owner: 'owner',
    admin: 'owner',
    workspace_owner: 'owner',
    workspace_admin: 'owner',
    viewer: 'viewer',
    member: 'viewer',
    workspace_viewer: 'viewer',
  };

const normalizeWorkspaceRoleInput = (roleKey?: string | null) =>
  String(roleKey || '')
    .trim()
    .toLowerCase();

export const normalizeWorkspaceRoleKeyForDisplay = (
  roleKey?: string | null,
): WorkspaceMemberUiRoleKey | null =>
  WORKSPACE_ROLE_DISPLAY_ALIASES[normalizeWorkspaceRoleInput(roleKey)] || null;

export const getWorkspaceRoleLabel = (roleKey?: string | null) => {
  const normalizedRoleKey = normalizeWorkspaceRoleKeyForDisplay(roleKey);
  if (normalizedRoleKey) {
    return WORKSPACE_MEMBER_ROLE_LABELS[normalizedRoleKey];
  }

  const rawRoleKey = normalizeWorkspaceRoleInput(roleKey);
  return rawRoleKey || '未知角色';
};

export const isWorkspaceOwnerEquivalentRole = (roleKey?: string | null) =>
  normalizeWorkspaceRoleKeyForDisplay(roleKey) === 'owner';

export const toStoredWorkspaceRoleKey = (roleKey?: string | null) => {
  const normalizedRoleKey = normalizeWorkspaceRoleKeyForDisplay(roleKey);
  if (normalizedRoleKey === 'owner') {
    return 'owner';
  }
  if (normalizedRoleKey === 'viewer') {
    return 'member';
  }

  return normalizeWorkspaceRoleInput(roleKey) || null;
};

export const SYSTEM_SAMPLE_KNOWLEDGE_BASES = [
  {
    slug: 'hr',
    name: 'HR',
    sampleDataset: 'HR',
  },
  {
    slug: 'ecommerce',
    name: 'ECOMMERCE',
    sampleDataset: 'ECOMMERCE',
  },
  {
    slug: 'music',
    name: 'MUSIC',
    sampleDataset: 'MUSIC',
  },
  {
    slug: 'nba',
    name: 'NBA',
    sampleDataset: 'NBA',
  },
] as const;

export const isDefaultWorkspace = (kind?: string | null) =>
  kind === WORKSPACE_KINDS.DEFAULT;

export const isRegularWorkspace = (kind?: string | null) =>
  !kind || kind === WORKSPACE_KINDS.REGULAR;

export const isSystemSampleKnowledgeBase = (kind?: string | null) =>
  kind === KNOWLEDGE_BASE_KINDS.SYSTEM_SAMPLE;

export const canCreateKnowledgeBaseInWorkspace = (
  workspaceKind?: string | null,
) => !isDefaultWorkspace(workspaceKind);

export const canManageWorkspaceJoinFlow = (workspaceKind?: string | null) =>
  !isDefaultWorkspace(workspaceKind);

export const canImportSampleDatasetInWorkspace = (
  workspaceKind?: string | null,
) => isDefaultWorkspace(workspaceKind);

export const getSampleDatasetImportRestrictionReason = (
  workspaceKind?: string | null,
) =>
  canImportSampleDatasetInWorkspace(workspaceKind)
    ? null
    : '系统样例已集中到系统样例空间，业务工作区不再支持导入样例数据，请直接配置真实数据库连接。';

export const getConnectorScopeRestrictionReason = ({
  workspaceKind,
  knowledgeBaseKind,
}: {
  workspaceKind?: string | null;
  knowledgeBaseKind?: string | null;
}) => {
  if (isSystemSampleKnowledgeBase(knowledgeBaseKind)) {
    return '系统样例知识库不支持接入或管理连接器';
  }

  if (isDefaultWorkspace(workspaceKind)) {
    return '系统样例空间不支持接入或管理连接器';
  }

  return null;
};

export const canManageConnectorsInScope = ({
  workspaceKind,
  knowledgeBaseKind,
}: {
  workspaceKind?: string | null;
  knowledgeBaseKind?: string | null;
}) => !getConnectorScopeRestrictionReason({ workspaceKind, knowledgeBaseKind });
