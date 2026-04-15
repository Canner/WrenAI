export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockValidateSession = jest.fn();
const mockGetSessionTokenFromRequest = jest.fn();
const mockCreateAuditEvent = jest.fn();
const mockListServiceAccounts = jest.fn();
const mockCreateServiceAccount = jest.fn();
const mockCreateApiToken = jest.fn();
const mockListProviders = jest.fn();
const mockCreateProvider = jest.fn();
const mockCreateAccessReview = jest.fn();
const mockCreateDirectoryGroup = jest.fn();
const mockUpdateDirectoryGroup = jest.fn();
const mockDeleteDirectoryGroup = jest.fn();
const mockCreateBreakGlassGrant = jest.fn();
const mockRevokeBreakGlassGrant = jest.fn();

jest.mock('@/common', () => ({
  components: {
    authService: {
      validateSession: mockValidateSession,
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
    automationService: {
      listServiceAccounts: mockListServiceAccounts,
      createServiceAccount: mockCreateServiceAccount,
      createApiToken: mockCreateApiToken,
    },
    identityProviderService: {
      listProviders: mockListProviders,
      createProvider: mockCreateProvider,
    },
    governanceService: {
      createAccessReview: mockCreateAccessReview,
      createDirectoryGroup: mockCreateDirectoryGroup,
      updateDirectoryGroup: mockUpdateDirectoryGroup,
      deleteDirectoryGroup: mockDeleteDirectoryGroup,
      createBreakGlassGrant: mockCreateBreakGlassGrant,
      revokeBreakGlassGrant: mockRevokeBreakGlassGrant,
    },
  },
}));

jest.mock('@server/context/actorClaims', () => ({
  getSessionTokenFromRequest: (...args: any[]) =>
    mockGetSessionTokenFromRequest(...args),
}));

describe('workspace governance api routes', () => {
  const workspaceGovernanceActions = [
    'workspace.read',
    'service_account.read',
    'service_account.create',
    'service_account.update',
    'service_account.delete',
    'api_token.read',
    'api_token.create',
    'api_token.revoke',
    'identity_provider.read',
    'identity_provider.manage',
    'access_review.read',
    'access_review.manage',
    'group.read',
    'group.manage',
    'role.read',
    'role.manage',
    'audit.read',
  ];

  const sessionPayload = {
    workspace: {
      id: 'workspace-1',
      name: 'Demo Workspace',
      kind: 'regular',
    },
    membership: { id: 'member-1', roleKey: 'owner' },
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      isPlatformAdmin: false,
    },
    session: {
      id: 'session-1',
    },
    actorClaims: {
      workspaceId: 'workspace-1',
      workspaceMemberId: 'member-1',
      roleKeys: ['owner'],
      permissionScopes: ['workspace:*', 'knowledge_base:*'],
      grantedActions: workspaceGovernanceActions,
      workspaceRoleSource: 'role_binding',
      platformRoleKeys: [],
      platformRoleSource: 'role_binding',
    },
  };

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      body: {},
      query: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => {
    const res: any = {
      statusCode: 200,
      body: undefined,
      setHeader: jest.fn(),
      status: jest.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: jest.fn((payload: any) => {
        res.body = payload;
        return res;
      }),
    };
    return res;
  };

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
    mockGetSessionTokenFromRequest.mockReturnValue('session-token');
    mockValidateSession.mockResolvedValue(sessionPayload);
    mockListServiceAccounts.mockResolvedValue([]);
    mockListProviders.mockResolvedValue([]);
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const platformAdminSessionPayload = {
    ...sessionPayload,
    user: {
      ...sessionPayload.user,
      isPlatformAdmin: true,
    },
    actorClaims: {
      ...sessionPayload.actorClaims,
      isPlatformAdmin: true,
      platformRoleKeys: ['platform_admin'],
      grantedActions: [
        ...workspaceGovernanceActions,
        'break_glass.manage',
        'impersonation.start',
      ],
      platformRoleSource: 'role_binding',
    },
  };

  it('creates a service account', async () => {
    const handler = (await import('../v1/workspace/service-accounts/index'))
      .default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        name: 'automation-bot',
        description: 'for jobs',
        roleKey: 'admin',
      },
    });
    const res = createRes();

    mockCreateServiceAccount.mockResolvedValue({
      id: 'sa-1',
      workspaceId: 'workspace-1',
      name: 'automation-bot',
      description: 'for jobs',
      roleKey: 'admin',
      status: 'active',
      createdBy: 'user-1',
      lastUsedAt: null,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    });

    await handler(req, res);

    expect(mockCreateServiceAccount).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      name: 'automation-bot',
      description: 'for jobs',
      roleKey: 'admin',
      createdBy: 'user-1',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({
      serviceAccount: expect.objectContaining({
        id: 'sa-1',
        name: 'automation-bot',
        roleKey: 'admin',
      }),
    });
  });

  it('returns 403 for service account creation in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    mockValidateSession.mockResolvedValue({
      ...sessionPayload,
      actorClaims: {
        ...sessionPayload.actorClaims,
        roleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
        grantedActions: [],
        workspaceRoleSource: 'legacy',
        platformRoleSource: 'legacy',
      },
    });

    const handler = (await import('../v1/workspace/service-accounts/index'))
      .default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        name: 'automation-bot',
        description: 'for jobs',
        roleKey: 'admin',
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.error).toMatch(/permission required/i);
    expect(mockCreateServiceAccount).not.toHaveBeenCalled();
  });

  it('creates an API token for a service account', async () => {
    const handler = (
      await import('../v1/workspace/service-accounts/[id]/tokens')
    ).default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1', id: 'sa-1' },
      body: {
        name: 'ci-token',
      },
    });
    const res = createRes();

    mockCreateApiToken.mockResolvedValue({
      token: {
        id: 'token-1',
        workspaceId: 'workspace-1',
        serviceAccountId: 'sa-1',
        name: 'ci-token',
        prefix: 'abcd1234',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        status: 'active',
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdBy: 'user-1',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
      },
      plainTextToken: 'wren_pat_secret',
    });

    await handler(req, res);

    expect(mockCreateApiToken).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      serviceAccountId: 'sa-1',
      name: 'ci-token',
      expiresAt: undefined,
      createdBy: 'user-1',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({
      token: expect.objectContaining({
        id: 'token-1',
        serviceAccountId: 'sa-1',
        name: 'ci-token',
      }),
      plainTextToken: 'wren_pat_secret',
    });
  });

  it('creates a workspace identity provider', async () => {
    const handler = (await import('../v1/workspace/identity-providers/index'))
      .default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        name: 'Enterprise OIDC',
        providerType: 'oidc',
        enabled: true,
        configJson: {
          issuer: 'https://issuer.example.com',
          clientId: 'client-id',
        },
      },
    });
    const res = createRes();

    mockCreateProvider.mockResolvedValue({
      id: 'idp-1',
      workspaceId: 'workspace-1',
      providerType: 'oidc',
      name: 'Enterprise OIDC',
      enabled: true,
      configJson: {
        issuer: 'https://issuer.example.com',
        clientId: 'client-id',
      },
    });

    await handler(req, res);

    expect(mockCreateProvider).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      providerType: 'oidc',
      name: 'Enterprise OIDC',
      enabled: true,
      configJson: {
        issuer: 'https://issuer.example.com',
        clientId: 'client-id',
      },
      createdBy: 'user-1',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({
      identityProvider: expect.objectContaining({
        id: 'idp-1',
        name: 'Enterprise OIDC',
      }),
    });
  });

  it('returns 403 for identity provider creation in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    mockValidateSession.mockResolvedValue({
      ...sessionPayload,
      actorClaims: {
        ...sessionPayload.actorClaims,
        roleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
        grantedActions: [],
        workspaceRoleSource: 'legacy',
        platformRoleSource: 'legacy',
      },
    });

    const handler = (await import('../v1/workspace/identity-providers/index'))
      .default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        name: 'Enterprise OIDC',
        providerType: 'oidc',
        enabled: true,
        configJson: {
          issuer: 'https://issuer.example.com',
          clientId: 'client-id',
        },
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.error).toMatch(/permission required/i);
    expect(mockCreateProvider).not.toHaveBeenCalled();
  });

  it('creates an access review', async () => {
    const handler = (await import('../v1/workspace/access-reviews/index'))
      .default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        title: 'Quarterly Review',
      },
    });
    const res = createRes();

    mockCreateAccessReview.mockResolvedValue({
      id: 'review-1',
      workspaceId: 'workspace-1',
      title: 'Quarterly Review',
      status: 'open',
      items: [],
    });

    await handler(req, res);

    expect(mockCreateAccessReview).toHaveBeenCalledWith({
      validatedSession: expect.objectContaining({
        user: expect.objectContaining({ id: 'user-1' }),
        workspace: expect.objectContaining({ id: 'workspace-1' }),
      }),
      title: 'Quarterly Review',
      dueAt: undefined,
      notes: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({
      accessReview: expect.objectContaining({
        id: 'review-1',
        title: 'Quarterly Review',
      }),
    });
  });

  it('creates a directory group with a role binding', async () => {
    const handler = (await import('../v1/workspace/groups/index')).default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        displayName: 'Finance Admins',
        roleKey: 'admin',
        memberIds: ['user-2'],
      },
    });
    const res = createRes();

    mockCreateDirectoryGroup.mockResolvedValue({
      id: 'group-1',
      workspaceId: 'workspace-1',
      displayName: 'Finance Admins',
      source: 'manual',
      status: 'active',
      roleKeys: ['admin'],
      members: [{ userId: 'user-2' }],
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    });

    await handler(req, res);

    expect(mockCreateDirectoryGroup).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      displayName: 'Finance Admins',
      roleKey: 'admin',
      memberIds: ['user-2'],
      createdBy: 'user-1',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({
      group: expect.objectContaining({
        id: 'group-1',
        displayName: 'Finance Admins',
        roleKeys: ['admin'],
      }),
    });
  });

  it('updates a directory group membership', async () => {
    const handler = (await import('../v1/workspace/groups/[id]')).default;
    const req = createReq({
      method: 'PATCH',
      query: { workspaceId: 'workspace-1', id: 'group-1' },
      body: {
        memberIds: ['user-2', 'user-3'],
        roleKey: 'member',
      },
    });
    const res = createRes();

    mockUpdateDirectoryGroup.mockResolvedValue({
      id: 'group-1',
      workspaceId: 'workspace-1',
      displayName: 'Finance Admins',
      source: 'manual',
      status: 'active',
      roleKeys: ['member'],
      members: [{ userId: 'user-2' }, { userId: 'user-3' }],
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T01:00:00.000Z',
    });

    await handler(req, res);

    expect(mockUpdateDirectoryGroup).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'group-1',
      displayName: undefined,
      roleKey: 'member',
      memberIds: ['user-2', 'user-3'],
      status: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      group: expect.objectContaining({
        id: 'group-1',
        memberCount: 2,
        roleKeys: ['member'],
      }),
    });
  });

  it('creates and revokes a break-glass grant', async () => {
    mockValidateSession.mockResolvedValue(platformAdminSessionPayload);

    const createHandler = (await import('../v1/workspace/break-glass/index'))
      .default;
    const createReqPayload = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        userId: 'user-2',
        roleKey: 'owner',
        durationMinutes: 30,
        reason: 'investigate production issue',
      },
    });
    const createResPayload = createRes();

    mockCreateBreakGlassGrant.mockResolvedValue({
      id: 'grant-1',
      workspaceId: 'workspace-1',
      userId: 'user-2',
      roleKey: 'owner',
      status: 'active',
      reason: 'investigate production issue',
      expiresAt: '2026-04-14T00:30:00.000Z',
      revokedAt: null,
      createdBy: 'user-1',
      user: {
        id: 'user-2',
        email: 'member@example.com',
        displayName: 'Member',
        status: 'active',
      },
    });

    await createHandler(createReqPayload, createResPayload);

    expect(mockCreateBreakGlassGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        validatedSession: expect.objectContaining({
          user: expect.objectContaining({ id: 'user-1' }),
          workspace: expect.objectContaining({ id: 'workspace-1' }),
        }),
        userId: 'user-2',
        roleKey: 'owner',
        reason: 'investigate production issue',
      }),
    );
    expect(createResPayload.status).toHaveBeenCalledWith(201);
    expect(createResPayload.body).toEqual({
      breakGlassGrant: expect.objectContaining({
        id: 'grant-1',
        userId: 'user-2',
        roleKey: 'owner',
      }),
    });

    const revokeHandler = (await import('../v1/workspace/break-glass/[id]'))
      .default;
    const revokeReqPayload = createReq({
      method: 'PATCH',
      query: { workspaceId: 'workspace-1', id: 'grant-1' },
    });
    const revokeResPayload = createRes();

    mockRevokeBreakGlassGrant.mockResolvedValue({
      id: 'grant-1',
      workspaceId: 'workspace-1',
      userId: 'user-2',
      roleKey: 'owner',
      status: 'revoked',
      reason: 'investigate production issue',
      expiresAt: '2026-04-14T00:30:00.000Z',
      revokedAt: '2026-04-14T00:10:00.000Z',
      createdBy: 'user-1',
      user: {
        id: 'user-2',
        email: 'member@example.com',
        displayName: 'Member',
        status: 'active',
      },
    });

    await revokeHandler(revokeReqPayload, revokeResPayload);

    expect(mockRevokeBreakGlassGrant).toHaveBeenCalledWith({
      validatedSession: expect.objectContaining({
        user: expect.objectContaining({ id: 'user-1' }),
        workspace: expect.objectContaining({ id: 'workspace-1' }),
      }),
      id: 'grant-1',
    });
    expect(revokeResPayload.status).toHaveBeenCalledWith(200);
    expect(revokeResPayload.body).toEqual({
      breakGlassGrant: expect.objectContaining({
        id: 'grant-1',
        revokedAt: '2026-04-14T00:10:00.000Z',
      }),
    });
  });
});
