import buildWorkspacePageDerivedState from './workspacePageDerivedState';
import type { WorkspaceOverviewPayload } from './workspacePageTypes';

const baseData: WorkspaceOverviewPayload = {
  workspace: {
    id: 'workspace-current',
    name: 'Current Workspace',
    kind: 'regular',
  },
  permissions: {
    canManageMembers: false,
    canInviteMembers: false,
    canCreateWorkspace: false,
    actions: {
      'workspace.member.status.update': true,
      'identity_provider.read': true,
      'group.read': true,
      'impersonation.start': true,
    },
  },
  workspaces: [
    { id: 'workspace-1', name: 'Finance Ops', slug: 'finance-ops' },
    { id: 'workspace-2', name: 'Sales Hub', slug: 'sales-hub' },
  ],
  discoverableWorkspaces: [
    { id: 'workspace-3', name: 'Analytics Lab', slug: 'analytics-lab' },
  ],
  applications: [
    {
      id: 'application-1',
      workspaceId: 'workspace-3',
      workspaceName: 'Analytics Lab',
      status: 'pending',
    },
  ],
  stats: {
    workspaceCount: 2,
    knowledgeBaseCount: 0,
    memberCount: 1,
  },
  members: [],
  reviewQueue: [],
  identityProviders: [
    {
      id: 'idp-1',
      providerType: 'saml',
      name: 'Enterprise SAML',
      enabled: true,
      configJson: {
        signingCertificateSummaries: [{ status: 'expired' }],
        hasScimBearerToken: true,
      },
    },
    {
      id: 'idp-2',
      providerType: 'oidc',
      name: 'Workforce OIDC',
      enabled: true,
      configJson: {},
    },
  ],
  directoryGroups: [
    {
      id: 'group-1',
      workspaceId: 'workspace-current',
      displayName: 'Ops Group',
      source: 'manual',
      status: 'active',
    },
  ],
  breakGlassGrants: [
    {
      id: 'grant-1',
      workspaceId: 'workspace-current',
      userId: 'user-1',
      roleKey: 'owner',
      status: 'active',
      reason: 'Emergency',
    },
    {
      id: 'grant-2',
      workspaceId: 'workspace-current',
      userId: 'user-2',
      roleKey: 'owner',
      status: 'revoked',
      reason: 'Expired',
      revokedAt: '2026-04-18T00:00:00.000Z',
    },
  ],
  accessReviews: [
    {
      id: 'review-1',
      title: 'Quarterly Review',
      status: 'open',
      items: [],
    },
  ],
};

describe('buildWorkspacePageDerivedState', () => {
  it('filters workspace collections by keyword and derives governance visibility', () => {
    const result = buildWorkspacePageDerivedState({
      data: baseData,
      searchKeyword: 'sales',
    });

    expect(result.filteredWorkspaceCards.map((item) => item.id)).toEqual([
      'workspace-2',
    ]);
    expect(result.filteredDiscoverableWorkspaces).toEqual([]);
    expect(result.filteredApplicationRecords).toEqual([]);
    expect(result.canManageMembers).toBe(true);
    expect(result.governanceCenterVisible).toBe(true);
    expect(result.scimEnabledProviderCount).toBe(1);
    expect(result.activeBreakGlassCount).toBe(1);
    expect(result.recentEnabledIdentityProviders).toEqual([
      'SAML · Enterprise SAML',
      'OIDC · Workforce OIDC',
    ]);
  });

  it('builds certificate summary and default workspace state from payload', () => {
    const result = buildWorkspacePageDerivedState({
      data: {
        ...baseData,
        defaultWorkspaceId: 'workspace-2',
        isPlatformAdmin: true,
      },
      searchKeyword: '',
    });

    expect(result.defaultWorkspaceId).toBe('workspace-2');
    expect(result.isPlatformAdmin).toBe(true);
    expect(result.enabledIdentityProviderCount).toBe(2);
    expect(result.directoryGroups).toHaveLength(1);
    expect(result.accessReviews).toHaveLength(1);
    expect(result.samlCertificateAlertSummary).toEqual({
      type: 'error',
      message: 'SAML 证书健康告警',
      description:
        '有 1 个已启用 SAML 提供方证书已过期，请前往“设置 > 身份与目录”处理。',
    });
  });

  it('treats any structured platform role as platform governance visibility for shared navigation', () => {
    const result = buildWorkspacePageDerivedState({
      data: {
        ...baseData,
        isPlatformAdmin: false,
        permissions: {
          ...baseData.permissions,
          canCreateWorkspace: false,
          actions: {
            ...baseData.permissions?.actions,
            'workspace.create': false,
          },
        },
        authorization: {
          actor: {
            principalType: 'user',
            isPlatformAdmin: false,
            platformRoleKeys: ['platform_workspace_admin'],
          },
        },
      },
      searchKeyword: '',
    });

    expect(result.isPlatformAdmin).toBe(true);
  });
});
