export type WorkspaceGovernanceSourceDetail = {
  kind?: string;
  label?: string;
};

export type WorkspaceGovernanceOverview = {
  authorization?: {
    actor?: {
      workspaceRoleSource?: 'legacy' | 'role_binding';
      platformRoleSource?: 'legacy' | 'role_binding';
      workspaceRoleKeys?: string[];
      platformRoleKeys?: string[];
      workspaceSourceDetails?: Array<{
        kind?: string;
        label?: string;
      }>;
      platformSourceDetails?: Array<{
        kind?: string;
        label?: string;
      }>;
    } | null;
  } | null;
  permissions?: {
    actions?: Record<string, boolean>;
  } | null;
  workspace?: {
    id: string;
    name: string;
    kind?: string | null;
  } | null;
  members?: Array<{
    id: string;
    userId: string;
    roleKey: string;
    status: string;
    sourceDetails?: Array<{
      kind: string;
      label: string;
    }>;
    user?: {
      email?: string | null;
      displayName?: string | null;
    } | null;
  }>;
  identityProviders?: Array<{
    id: string;
    providerType: string;
    name: string;
    enabled: boolean;
    configJson?: Record<string, any> | null;
  }>;
  directoryGroups?: Array<{
    id: string;
    displayName: string;
    source?: string;
    status?: string;
    roleKeys?: string[];
    memberIds?: string[];
    memberCount?: number;
    sourceDetails?: Array<{
      kind: string;
      label: string;
    }>;
  }>;
  breakGlassGrants?: Array<{
    id: string;
    userId: string;
    roleKey: string;
    status: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
    reason?: string | null;
    user?: {
      email?: string | null;
      displayName?: string | null;
    } | null;
  }>;
  accessReviews?: Array<{
    id: string;
    title: string;
    status: string;
    createdAt?: string | null;
    dueAt?: string | null;
    items: Array<{
      id: string;
      userId?: string | null;
      roleKey?: string | null;
      status: string;
      decision?: string | null;
      reviewedAt?: string | null;
    }>;
  }>;
  impersonation?: {
    active?: boolean;
    reason?: string | null;
    canStop?: boolean;
    impersonatorUserId?: string | null;
  } | null;
  ownerCandidates?: Array<{
    id: string;
    email: string;
    displayName?: string | null;
    status: string;
  }>;
  serviceAccounts?: Array<{
    id: string;
    name: string;
    description?: string | null;
    roleKey: string;
    status: string;
    workspaceId?: string;
    activeTokenCount?: number;
    lastUsedAt?: string | null;
    sourceDetails?: Array<{
      kind: string;
      label: string;
    }>;
  }>;
  apiTokens?: Array<{
    id: string;
    serviceAccountId?: string | null;
    name: string;
    prefix?: string;
    status: string;
    expiresAt?: string | null;
    lastUsedAt?: string | null;
    revokedAt?: string | null;
    sourceDetails?: Array<{
      kind: string;
      label: string;
    }>;
  }>;
  stats?: {
    memberCount?: number;
    reviewQueueCount?: number;
    enterpriseSsoCount?: number;
    accessReviewCount?: number;
    directoryGroupCount?: number;
    breakGlassGrantCount?: number;
    serviceAccountCount?: number;
  } | null;
};

export type WorkspaceAuditEvent = {
  id: string;
  action: string;
  result: string;
  actorType?: string | null;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  createdAt?: string | null;
};

export type WorkspaceRoleCatalogItem = {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  scopeType: string;
  scopeId: string;
  isSystem: boolean;
  isActive: boolean;
  permissionNames: string[];
  bindingCount: number;
};

export type WorkspaceRoleBindingItem = {
  id: string;
  principalType: 'user' | 'group' | 'service_account';
  principalId: string;
  principalLabel: string;
  roleId: string;
  roleName: string;
  roleDisplayName: string;
  isSystem: boolean;
  createdAt?: string | null;
};

export type WorkspacePermissionCatalogItem = {
  name: string;
  description: string;
  assignable: boolean;
};

export type WorkspaceAuthorizationExplainResponse = {
  actor: {
    principalType: string;
    principalId: string;
    workspaceRoleKeys?: string[];
    platformRoleKeys?: string[];
    grantedActions?: string[];
  };
  directBindings: Array<{
    roleName: string;
    roleDisplayName: string;
  }>;
  groupBindings: Array<{
    groupId: string;
    groupName: string;
    roleName: string;
    roleDisplayName: string;
  }>;
  platformBindings: Array<{
    roleName: string;
    roleDisplayName: string;
  }>;
  grantedActions: string[];
  decision?: {
    allowed: boolean;
    reason?: string | null;
    statusCode?: number;
  } | null;
};

export const ROLE_OPTIONS = [
  { label: '成员', value: 'member' },
  { label: '管理员', value: 'admin' },
];

export const IDENTITY_PROVIDER_OPTIONS = [
  { label: 'OIDC', value: 'oidc' },
  { label: 'SAML', value: 'saml' },
] as const;

export const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatUserLabel = (
  displayName?: string | null,
  email?: string | null,
  fallback = '—',
) => {
  if (displayName && email && displayName !== email) {
    return `${displayName} · ${email}`;
  }
  return email || displayName || fallback;
};

export const formatRoleSourceLabel = (source?: 'legacy' | 'role_binding') =>
  !source
    ? '—'
    : source === 'role_binding'
      ? '结构化角色绑定'
      : 'Legacy 兼容来源';

export const formatDirectoryGroupSource = (source?: string | null) =>
  source === 'scim'
    ? 'SCIM 同步'
    : source === 'manual'
      ? '手动绑定'
      : source || '—';

export const metadataSourceColor = (source: 'url' | 'xml' | 'none') =>
  source === 'url' ? 'blue' : source === 'xml' ? 'purple' : 'default';

export const sourceDetailColor = (kind?: string) => {
  switch (kind) {
    case 'direct_binding':
    case 'service_account_binding':
    case 'platform_binding':
      return 'blue';
    case 'group_binding':
    case 'token_binding':
      return 'purple';
    default:
      return 'default';
  }
};
