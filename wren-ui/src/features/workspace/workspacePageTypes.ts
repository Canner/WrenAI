export type WorkspaceMemberView = {
  id: string;
  userId: string;
  roleKey: string;
  status: string;
  user?: {
    id: string;
    email: string;
    displayName?: string | null;
    status: string;
  } | null;
};

export type WorkspaceListItem = {
  id: string;
  name: string;
  slug?: string | null;
  status?: string | null;
  kind?: 'regular' | 'default';
};

export type WorkspaceOverviewPayload = {
  user?: {
    id: string;
    email: string;
    displayName?: string | null;
    isPlatformAdmin?: boolean;
    defaultWorkspaceId?: string | null;
  } | null;
  isPlatformAdmin?: boolean;
  defaultWorkspaceId?: string | null;
  workspace: WorkspaceListItem;
  membership?: {
    id: string;
    roleKey: string;
  } | null;
  permissions?: {
    canManageMembers?: boolean;
    canInviteMembers?: boolean;
    canApproveMembers?: boolean;
    canManageSchedules?: boolean;
    canCreateWorkspace?: boolean;
    actions?: Record<string, boolean>;
  } | null;
  authorization?: {
    actor?: {
      principalType: string;
      workspaceRoleKeys?: string[];
      platformRoleKeys?: string[];
      isPlatformAdmin?: boolean;
    } | null;
  } | null;
  workspaces: WorkspaceListItem[];
  discoverableWorkspaces: WorkspaceListItem[];
  serviceAccounts?: Array<{
    id: string;
    workspaceId: string;
    name: string;
    description?: string | null;
    roleKey: string;
    status: string;
    tokenCount?: number;
    activeTokenCount?: number;
    lastUsedAt?: string | null;
    createdAt?: string | null;
  }>;
  apiTokens?: Array<{
    id: string;
    workspaceId: string;
    serviceAccountId?: string | null;
    name: string;
    prefix: string;
    status: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
    lastUsedAt?: string | null;
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
    workspaceId: string;
    displayName: string;
    source: string;
    status: string;
    roleKeys?: string[];
    memberIds?: string[];
    memberCount?: number;
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
  breakGlassGrants?: Array<{
    id: string;
    workspaceId: string;
    userId: string;
    roleKey: string;
    status: string;
    reason: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
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
      notes?: string | null;
    }>;
  }>;
  impersonation?: {
    active?: boolean;
    canStop?: boolean;
    impersonatorUserId?: string | null;
    reason?: string | null;
  } | null;
  applications: Array<{
    id: string;
    workspaceId: string;
    workspaceName: string;
    status: string;
    roleKey?: string | null;
    kind?: 'regular' | 'default';
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
  stats: {
    workspaceCount: number;
    knowledgeBaseCount: number;
    memberCount: number;
    reviewQueueCount?: number;
    serviceAccountCount?: number;
    enterpriseSsoCount?: number;
    accessReviewCount?: number;
    directoryGroupCount?: number;
    breakGlassGrantCount?: number;
  };
  members: WorkspaceMemberView[];
  reviewQueue?: WorkspaceMemberView[];
};

export type WorkspacePageTab = 'mine' | 'discover' | 'applications';
