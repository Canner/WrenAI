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
