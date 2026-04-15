const mockBootstrapOwner = jest.fn();
const mockLogin = jest.fn();
const mockLogout = jest.fn();
const mockValidateSession = jest.fn();
const mockRegisterLocalUser = jest.fn();
const mockChangeLocalPassword = jest.fn();
const mockListWorkspacesForUser = jest.fn();
const mockListKnowledgeBases = jest.fn();
const mockListKbSnapshots = jest.fn();
const mockGetKbSnapshot = jest.fn();
const mockFindAuthIdentity = jest.fn();
const mockEnforceRateLimit = jest.fn();
const mockStartWorkspaceSSO = jest.fn();
const mockCompleteWorkspaceSSO = jest.fn();
const mockFindSsoSession = jest.fn();
const mockStartImpersonation = jest.fn();
const mockStopImpersonation = jest.fn();
const mockCreateAuditEvent = jest.fn();

jest.mock('@/common', () => ({
  components: {
    authService: {
      bootstrapOwner: mockBootstrapOwner,
      login: mockLogin,
      logout: mockLogout,
      validateSession: mockValidateSession,
      registerLocalUser: mockRegisterLocalUser,
      changeLocalPassword: mockChangeLocalPassword,
    },
    workspaceService: {
      listWorkspacesForUser: mockListWorkspacesForUser,
    },
    knowledgeBaseRepository: {
      findAllBy: mockListKnowledgeBases,
    },
    kbSnapshotRepository: {
      findAllBy: mockListKbSnapshots,
      findOneBy: mockGetKbSnapshot,
    },
    authIdentityRepository: {
      findOneBy: mockFindAuthIdentity,
    },
    identityProviderService: {
      startWorkspaceSSO: mockStartWorkspaceSSO,
      completeWorkspaceSSO: mockCompleteWorkspaceSSO,
    },
    ssoSessionRepository: {
      findOneBy: mockFindSsoSession,
    },
    governanceService: {
      startImpersonation: mockStartImpersonation,
      stopImpersonation: mockStopImpersonation,
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
  },
}));

jest.mock('@server/utils/rateLimit', () => ({
  enforceRateLimit: (...args: any[]) => mockEnforceRateLimit(...args),
}));

describe('pages/api/auth routes', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      body: {},
      query: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => {
    const headers: Record<string, any> = {};
    const res: any = {
      statusCode: 200,
      body: undefined,
      setHeader: jest.fn((key: string, value: any) => {
        headers[key] = value;
      }),
      status: jest.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: jest.fn((payload: any) => {
        res.body = payload;
        return res;
      }),
      writeHead: jest.fn((code: number, payload: any) => {
        res.statusCode = code;
        res.headers = payload;
        return res;
      }),
      end: jest.fn(),
      getHeader: (key: string) => headers[key],
    };
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnforceRateLimit.mockResolvedValue({ limited: false });
    mockListKnowledgeBases.mockResolvedValue([]);
    mockListKbSnapshots.mockResolvedValue([]);
    mockGetKbSnapshot.mockResolvedValue(null);
    mockFindAuthIdentity.mockResolvedValue({ id: 'identity-1' });
    mockFindSsoSession.mockResolvedValue(null);
  });

  it('bootstraps owner and sets session cookie', async () => {
    const handler = (await import('../auth/bootstrap')).default;
    const req = createReq({
      method: 'POST',
      body: {
        email: 'owner@example.com',
        password: 'secret',
        displayName: 'Owner',
      },
    });
    const res = createRes();

    mockBootstrapOwner.mockResolvedValue({
      sessionToken: 'bootstrap-token',
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        isPlatformAdmin: true,
        defaultWorkspaceId: 'workspace-default',
      },
      workspace: { id: 'workspace-default', name: '系统样例空间' },
      membership: { id: 'member-1', roleKey: 'owner' },
      actorClaims: {
        workspaceId: 'workspace-default',
        roleKeys: ['owner'],
        isPlatformAdmin: true,
      },
    });

    await handler(req, res);

    expect(mockBootstrapOwner).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'secret',
      displayName: 'Owner',
      locale: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.getHeader('Set-Cookie')).toContain(
      'wren_session=bootstrap-token',
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          id: 'user-1',
          email: 'owner@example.com',
        }),
        workspace: { id: 'workspace-default', name: '系统样例空间' },
        defaultWorkspaceId: 'workspace-default',
        runtimeSelector: {
          workspaceId: 'workspace-default',
          knowledgeBaseId: null,
          kbSnapshotId: null,
          deployHash: null,
        },
      }),
    );
  });

  it('logs in and returns session-scoped actor data', async () => {
    const handler = (await import('../auth/login')).default;
    const req = createReq({
      method: 'POST',
      body: {
        email: 'member@example.com',
        password: 'passw0rd',
        workspaceId: 'workspace-1',
      },
    });
    const res = createRes();

    mockLogin.mockResolvedValue({
      sessionToken: 'login-token',
      user: {
        id: 'user-1',
        email: 'member@example.com',
        isPlatformAdmin: false,
        defaultWorkspaceId: 'workspace-1',
      },
      workspace: { id: 'workspace-1', name: 'Demo' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['member'],
        permissionScopes: [],
        grantedActions: ['workspace.read'],
        workspaceRoleSource: 'role_binding',
        platformRoleKeys: [],
        platformRoleSource: 'role_binding',
        isPlatformAdmin: false,
      },
    });

    await handler(req, res);

    expect(mockLogin).toHaveBeenCalledWith({
      email: 'member@example.com',
      password: 'passw0rd',
      workspaceId: 'workspace-1',
    });
    expect(mockFindAuthIdentity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.getHeader('Set-Cookie')).toContain('wren_session=login-token');
    expect(res.body).toEqual(
      expect.objectContaining({
        workspace: { id: 'workspace-1', name: 'Demo' },
        defaultWorkspaceId: 'workspace-1',
        isPlatformAdmin: false,
      }),
    );
  });

  it('uses actorClaims instead of legacy user flags for platform admin session payloads', async () => {
    const handler = (await import('../auth/login')).default;
    const req = createReq({
      method: 'POST',
      body: {
        email: 'member@example.com',
        password: 'passw0rd',
        workspaceId: 'workspace-1',
      },
    });
    const res = createRes();

    mockLogin.mockResolvedValue({
      sessionToken: 'login-token',
      user: {
        id: 'user-1',
        email: 'member@example.com',
        isPlatformAdmin: true,
        defaultWorkspaceId: 'workspace-1',
      },
      workspace: { id: 'workspace-1', name: 'Demo' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['member'],
        isPlatformAdmin: false,
      },
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          isPlatformAdmin: false,
        }),
        isPlatformAdmin: false,
      }),
    );
  });

  it('bootstraps owner on first login when autoBootstrap is enabled and no local identity exists', async () => {
    const handler = (await import('../auth/login')).default;
    const req = createReq({
      method: 'POST',
      body: {
        email: 'owner@example.com',
        password: 'secret',
        autoBootstrap: true,
      },
    });
    const res = createRes();

    mockLogin.mockRejectedValue(new Error('Invalid email or password'));
    mockFindAuthIdentity.mockResolvedValue(null);
    mockBootstrapOwner.mockResolvedValue({
      sessionToken: 'bootstrap-token',
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        isPlatformAdmin: true,
        defaultWorkspaceId: 'workspace-default',
      },
      workspace: { id: 'workspace-default', name: '系统样例空间' },
      membership: { id: 'member-1', roleKey: 'owner' },
      actorClaims: {
        workspaceId: 'workspace-default',
        roleKeys: ['owner'],
        isPlatformAdmin: true,
      },
    });

    await handler(req, res);

    expect(mockLogin).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'secret',
      workspaceId: undefined,
    });
    expect(mockFindAuthIdentity).toHaveBeenCalledWith({
      providerType: 'local',
    });
    expect(mockBootstrapOwner).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'secret',
      displayName: 'Owner',
      locale: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.getHeader('Set-Cookie')).toContain(
      'wren_session=bootstrap-token',
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        bootstrapped: true,
        workspace: { id: 'workspace-default', name: '系统样例空间' },
        defaultWorkspaceId: 'workspace-default',
        isPlatformAdmin: true,
        runtimeSelector: {
          workspaceId: 'workspace-default',
          knowledgeBaseId: null,
          kbSnapshotId: null,
          deployHash: null,
        },
      }),
    );
  });

  it('registers a user into the default workspace and sets session cookie', async () => {
    const handler = (await import('../auth/register')).default;
    const req = createReq({
      method: 'POST',
      body: {
        email: 'member@example.com',
        password: 'secret',
        displayName: 'Member',
      },
    });
    const res = createRes();

    mockRegisterLocalUser.mockResolvedValue({
      sessionToken: 'register-token',
      user: {
        id: 'user-2',
        email: 'member@example.com',
        defaultWorkspaceId: 'workspace-default',
      },
      workspace: { id: 'workspace-default', name: '系统样例空间' },
      membership: { id: 'member-2', roleKey: 'member' },
      actorClaims: { workspaceId: 'workspace-default', roleKeys: ['member'] },
    });

    await handler(req, res);

    expect(mockRegisterLocalUser).toHaveBeenCalledWith({
      email: 'member@example.com',
      password: 'secret',
      displayName: 'Member',
      locale: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.getHeader('Set-Cookie')).toContain(
      'wren_session=register-token',
    );
  });

  it('clears cookie and revokes session on logout', async () => {
    const handler = (await import('../auth/logout')).default;
    const req = createReq({
      method: 'POST',
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    await handler(req, res);

    expect(mockLogout).toHaveBeenCalledWith('session-token');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.getHeader('Set-Cookie')).toContain('Max-Age=0');
    expect(res.body).toEqual({ ok: true });
  });

  it('changes password for the authenticated local account', async () => {
    const handler = (await import('../auth/password')).default;
    const req = createReq({
      method: 'POST',
      headers: { cookie: 'wren_session=session-token' },
      body: {
        currentPassword: 'old-secret',
        nextPassword: 'new-secret-1',
      },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'member@example.com',
      },
    });
    mockChangeLocalPassword.mockResolvedValue(undefined);

    await handler(req, res);

    expect(mockChangeLocalPassword).toHaveBeenCalledWith({
      userId: 'user-1',
      currentPassword: 'old-secret',
      nextPassword: 'new-secret-1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects password change when not authenticated', async () => {
    const handler = (await import('../auth/password')).default;
    const req = createReq({
      method: 'POST',
      body: {
        currentPassword: 'old-secret',
        nextPassword: 'new-secret-1',
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
  });

  it('validates password change payload', async () => {
    const handler = (await import('../auth/password')).default;
    const req = createReq({
      method: 'POST',
      headers: { cookie: 'wren_session=session-token' },
      body: {
        currentPassword: '',
        nextPassword: '',
      },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'member@example.com',
      },
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({
      error: 'currentPassword and nextPassword are required',
    });
  });

  it('returns authenticated session payload with workspace list', async () => {
    const handler = (await import('../auth/session')).default;
    const req = createReq({
      method: 'GET',
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      session: {
        id: 'session-1',
        expiresAt: '2026-04-10T00:00:00.000Z',
        lastSeenAt: '2026-04-03T00:00:00.000Z',
      },
      user: {
        id: 'user-1',
        email: 'member@example.com',
        isPlatformAdmin: false,
        defaultWorkspaceId: 'workspace-1',
      },
      workspace: { id: 'workspace-1', name: 'Demo', kind: 'regular' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['member'],
        permissionScopes: [],
        grantedActions: ['workspace.read'],
        workspaceRoleSource: 'role_binding',
        platformRoleKeys: [],
        platformRoleSource: 'role_binding',
        isPlatformAdmin: false,
      },
    });
    mockListWorkspacesForUser.mockResolvedValue([
      { id: 'workspace-1', name: 'Demo', kind: 'regular' },
    ]);
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-b',
        workspaceId: 'workspace-1',
        name: 'Beta KB',
        defaultKbSnapshotId: null,
      },
      {
        id: 'kb-a',
        workspaceId: 'workspace-1',
        name: 'Alpha KB',
        defaultKbSnapshotId: 'snapshot-1',
      },
    ]);
    mockListKbSnapshots.mockResolvedValue([
      {
        id: 'snapshot-1',
        knowledgeBaseId: 'kb-a',
        displayName: 'Prod',
        deployHash: 'deploy-1',
        status: 'active',
      },
    ]);

    await handler(req, res);

    expect(mockValidateSession).toHaveBeenCalledWith(
      'session-token',
      'workspace-1',
    );
    expect(mockListWorkspacesForUser).toHaveBeenCalledWith('user-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      authenticated: true,
      user: {
        id: 'user-1',
        email: 'member@example.com',
        isPlatformAdmin: false,
        defaultWorkspaceId: 'workspace-1',
      },
      workspace: { id: 'workspace-1', name: 'Demo', kind: 'regular' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['member'],
        permissionScopes: [],
        grantedActions: ['workspace.read'],
        workspaceRoleSource: 'role_binding',
        platformRoleKeys: [],
        platformRoleSource: 'role_binding',
        isPlatformAdmin: false,
      },
      authorization: {
        actor: expect.objectContaining({
          principalType: 'user',
          principalId: 'user-1',
          workspaceId: 'workspace-1',
          workspaceMemberId: 'member-1',
          workspaceRoleKeys: ['member'],
          permissionScopes: [],
          isPlatformAdmin: false,
          platformRoleKeys: [],
        }),
        actions: expect.objectContaining({
          'workspace.create': false,
          'workspace.default.set': true,
          'workspace.member.invite': false,
          'workspace.schedule.manage': false,
          'knowledge_base.create': false,
        }),
      },
      workspaces: [{ id: 'workspace-1', name: 'Demo', kind: 'regular' }],
      isPlatformAdmin: false,
      defaultWorkspaceId: 'workspace-1',
      runtimeSelector: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-a',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      },
      session: {
        id: 'session-1',
        expiresAt: '2026-04-10T00:00:00.000Z',
        lastSeenAt: '2026-04-03T00:00:00.000Z',
        impersonatorUserId: null,
        impersonationReason: null,
      },
      impersonation: {
        active: false,
        canStop: false,
        impersonatorUserId: null,
        reason: null,
      },
    });
  });

  it('prefers a deployable knowledge base for the bootstrap runtime selector', async () => {
    const handler = (await import('../auth/session')).default;
    const req = createReq({
      method: 'GET',
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      session: {
        id: 'session-1',
        expiresAt: '2026-04-10T00:00:00.000Z',
        lastSeenAt: '2026-04-03T00:00:00.000Z',
      },
      user: {
        id: 'user-1',
        email: 'member@example.com',
        isPlatformAdmin: false,
        defaultWorkspaceId: 'workspace-1',
      },
      workspace: { id: 'workspace-1', name: 'Demo' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['member'],
        permissionScopes: [],
        grantedActions: ['workspace.read'],
        workspaceRoleSource: 'role_binding',
        platformRoleKeys: [],
        platformRoleSource: 'role_binding',
        isPlatformAdmin: false,
      },
    });
    mockListWorkspacesForUser.mockResolvedValue([
      { id: 'workspace-1', name: 'Demo' },
    ]);
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-empty',
        workspaceId: 'workspace-1',
        name: '111',
        defaultKbSnapshotId: null,
      },
      {
        id: 'kb-ready',
        workspaceId: 'workspace-1',
        name: '电商订单数据',
        defaultKbSnapshotId: 'snapshot-ready',
      },
    ]);
    mockListKbSnapshots.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'snapshot-ready',
        knowledgeBaseId: 'kb-ready',
        displayName: 'Prod',
        deployHash: 'deploy-ready',
        status: 'active',
      },
    ]);

    await handler(req, res);

    expect(mockListKbSnapshots).toHaveBeenNthCalledWith(1, {
      knowledgeBaseId: 'kb-empty',
    });
    expect(mockListKbSnapshots).toHaveBeenNthCalledWith(2, {
      knowledgeBaseId: 'kb-ready',
    });
    expect(res.body?.runtimeSelector).toEqual({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-ready',
      kbSnapshotId: 'snapshot-ready',
      deployHash: 'deploy-ready',
    });
  });

  it('returns unauthenticated when no session token is present', async () => {
    const handler = (await import('../auth/session')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    await handler(req, res);

    expect(mockValidateSession).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it('returns 403 when current workspace session read is not granted', async () => {
    const handler = (await import('../auth/session')).default;
    const req = createReq({
      method: 'GET',
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      session: {
        id: 'session-1',
      },
      user: {
        id: 'user-1',
        email: 'member@example.com',
        isPlatformAdmin: false,
        defaultWorkspaceId: 'workspace-1',
      },
      workspace: { id: 'workspace-1', name: 'Demo', kind: 'regular' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['member'],
        workspaceRoleSource: 'role_binding',
        grantedActions: [],
      },
    });

    await handler(req, res);

    expect(mockListWorkspacesForUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({
      error: 'Workspace read permission required',
    });
  });

  it('normalizes session user platform admin from actorClaims instead of legacy user flags', async () => {
    const handler = (await import('../auth/session')).default;
    const req = createReq({
      method: 'GET',
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      session: {
        id: 'session-1',
        expiresAt: '2026-04-10T00:00:00.000Z',
      },
      user: {
        id: 'user-1',
        email: 'member@example.com',
        isPlatformAdmin: true,
        defaultWorkspaceId: 'workspace-1',
      },
      workspace: { id: 'workspace-1', name: 'Demo', kind: 'regular' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['member'],
        isPlatformAdmin: false,
        platformRoleKeys: [],
        grantedActions: ['workspace.read'],
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'role_binding',
      },
    });
    mockListWorkspacesForUser.mockResolvedValue([
      { id: 'workspace-1', name: 'Demo', kind: 'regular' },
    ]);
    mockListKnowledgeBases.mockResolvedValue([]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          id: 'user-1',
          isPlatformAdmin: false,
          defaultWorkspaceId: 'workspace-1',
        }),
        isPlatformAdmin: false,
        authorization: {
          actor: expect.objectContaining({
            isPlatformAdmin: false,
            platformRoleKeys: [],
            platformRoleSource: 'role_binding',
          }),
          actions: expect.any(Object),
        },
      }),
    );
  });

  it('returns 429 when login attempts are rate limited', async () => {
    const handler = (await import('../auth/login')).default;
    const req = createReq({
      method: 'POST',
      body: {
        email: 'member@example.com',
        password: 'passw0rd',
      },
    });
    const res = createRes();

    mockEnforceRateLimit.mockResolvedValueOnce({
      limited: true,
      response: res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfterMs: 60000,
      }),
    });

    await handler(req, res);

    expect(mockLogin).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.body).toEqual({
      error: 'Too many requests. Please try again later.',
      retryAfterMs: 60000,
    });
  });

  it('clears stale session cookie when validation fails', async () => {
    const handler = (await import('../auth/session')).default;
    const req = createReq({
      method: 'GET',
      headers: { cookie: 'wren_session=stale-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue(null);

    await handler(req, res);

    expect(mockValidateSession).toHaveBeenCalledWith('stale-token', undefined);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.getHeader('Set-Cookie')).toContain('Max-Age=0');
    expect(res.body).toEqual({ authenticated: false });
  });

  it('marks session cookie as secure for forwarded https requests', async () => {
    const handler = (await import('../auth/login')).default;
    const req = createReq({
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: {
        email: 'member@example.com',
        password: 'passw0rd',
      },
    });
    const res = createRes();

    mockLogin.mockResolvedValue({
      sessionToken: 'secure-login-token',
      user: { id: 'user-1', email: 'member@example.com' },
      workspace: { id: 'workspace-1', name: 'Demo' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['member'],
        permissionScopes: [],
        grantedActions: ['workspace.read'],
        workspaceRoleSource: 'role_binding',
        platformRoleKeys: [],
        platformRoleSource: 'role_binding',
        isPlatformAdmin: false,
      },
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.getHeader('Set-Cookie')).toContain('Secure');
  });

  it('restores redirectTo after enterprise SSO callback', async () => {
    const handler = (await import('../auth/sso/callback')).default;
    const req = createReq({
      method: 'GET',
      query: {
        state: 'state-1',
        code: 'code-1',
      },
      headers: {
        host: 'localhost:3000',
      },
    });
    const res = createRes();

    mockFindSsoSession.mockResolvedValue({
      id: 'sso-session-1',
      state: 'state-1',
      redirectTo: '/workspace?tab=members',
    });
    mockCompleteWorkspaceSSO.mockResolvedValue({
      sessionToken: 'sso-token',
      user: {
        id: 'user-1',
        email: 'member@example.com',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo',
      },
      membership: {
        id: 'member-1',
        roleKey: 'member',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['member'],
      },
    });
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-a',
        workspaceId: 'workspace-1',
        name: 'Alpha KB',
        defaultKbSnapshotId: null,
      },
    ]);
    mockListKbSnapshots.mockReset();
    mockListKbSnapshots.mockResolvedValue([]);

    await handler(req, res);

    expect(mockCompleteWorkspaceSSO).toHaveBeenCalledWith({
      state: 'state-1',
      relayState: 'state-1',
      code: 'code-1',
      samlResponse: undefined,
      origin: 'http://localhost:3000',
    });
    expect(res.getHeader('Set-Cookie')).toContain('wren_session=sso-token');
    expect(res.writeHead).toHaveBeenCalledWith(302, {
      Location:
        '/workspace?tab=members&workspaceId=workspace-1&knowledgeBaseId=kb-a',
    });
    expect(res.end).toHaveBeenCalled();
  });

  it('supports SAML POST callback with RelayState', async () => {
    const handler = (await import('../auth/sso/callback')).default;
    const req = createReq({
      method: 'POST',
      body: {
        RelayState: 'state-saml',
        SAMLResponse: 'encoded-saml-response',
      },
      headers: {
        host: 'localhost:3000',
      },
    });
    const res = createRes();

    mockFindSsoSession.mockResolvedValue({
      id: 'sso-session-2',
      state: 'state-saml',
      redirectTo: '/workspace?tab=members',
    });
    mockCompleteWorkspaceSSO.mockResolvedValue({
      sessionToken: 'saml-sso-token',
      user: {
        id: 'user-1',
        email: 'member@example.com',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo',
      },
      membership: {
        id: 'member-1',
        roleKey: 'member',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['member'],
      },
    });
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-a',
        workspaceId: 'workspace-1',
        name: 'Alpha KB',
        defaultKbSnapshotId: null,
      },
    ]);

    await handler(req, res);

    expect(mockCompleteWorkspaceSSO).toHaveBeenCalledWith({
      state: 'state-saml',
      relayState: 'state-saml',
      code: undefined,
      samlResponse: 'encoded-saml-response',
      origin: 'http://localhost:3000',
    });
    expect(res.getHeader('Set-Cookie')).toContain(
      'wren_session=saml-sso-token',
    );
    expect(res.writeHead).toHaveBeenCalledWith(302, {
      Location:
        '/workspace?tab=members&workspaceId=workspace-1&knowledgeBaseId=kb-a',
    });
    expect(res.end).toHaveBeenCalled();
  });

  it('starts enterprise SSO with workspace slug and redirectTo', async () => {
    const handler = (await import('../auth/sso/start')).default;
    const req = createReq({
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'user-agent': 'jest',
        'x-forwarded-for': '127.0.0.1',
      },
      body: {
        workspaceSlug: 'demo-workspace',
        redirectTo: '/workspace?tab=members',
      },
    });
    const res = createRes();

    mockStartWorkspaceSSO.mockResolvedValue({
      authorizeUrl: 'https://idp.example.com/authorize',
    });

    await handler(req, res);

    expect(mockStartWorkspaceSSO).toHaveBeenCalledWith({
      workspaceSlug: 'demo-workspace',
      origin: 'http://localhost:3000',
      redirectTo: '/workspace?tab=members',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      authorizeUrl: 'https://idp.example.com/authorize',
    });
  });

  it('starts impersonation and returns runtime selector', async () => {
    const handler = (await import('../auth/impersonation/start')).default;
    const req = createReq({
      method: 'POST',
      headers: {
        cookie: 'wren_session=session-token',
      },
      body: {
        targetUserId: 'user-2',
        reason: 'support-debug',
      },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        isPlatformAdmin: true,
        defaultWorkspaceId: 'workspace-1',
        displayName: 'Owner',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo Workspace',
        slug: 'demo',
        kind: 'regular',
      },
      membership: {
        id: 'member-1',
        roleKey: 'owner',
      },
      session: {
        id: 'session-1',
        impersonatorUserId: null,
        impersonationReason: null,
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['owner'],
        permissionScopes: ['workspace:*', 'knowledge_base:*'],
        grantedActions: ['impersonation.start'],
        isPlatformAdmin: true,
        platformRoleKeys: ['platform_admin'],
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'role_binding',
      },
    });
    mockStartImpersonation.mockResolvedValue({
      sessionToken: 'impersonation-token',
      user: {
        id: 'user-2',
        email: 'member@example.com',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo Workspace',
      },
      membership: {
        id: 'member-2',
        roleKey: 'member',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['member'],
      },
    });
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-a',
        workspaceId: 'workspace-1',
        name: 'Alpha KB',
        defaultKbSnapshotId: null,
      },
    ]);

    await handler(req, res);

    expect(mockStartImpersonation).toHaveBeenCalledWith({
      validatedSession: expect.objectContaining({
        user: expect.objectContaining({ id: 'user-1' }),
        workspace: expect.objectContaining({ id: 'workspace-1' }),
      }),
      targetUserId: 'user-2',
      workspaceId: undefined,
      reason: 'support-debug',
    });
    expect(res.getHeader('Set-Cookie')).toContain(
      'wren_session=impersonation-token',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        runtimeSelector: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-a',
          kbSnapshotId: null,
          deployHash: null,
        },
      }),
    );
  });

  it('stops impersonation and restores original session', async () => {
    const handler = (await import('../auth/impersonation/stop')).default;
    const req = createReq({
      method: 'POST',
      headers: {
        cookie: 'wren_session=session-token',
      },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      session: {
        id: 'session-imp',
        impersonatorUserId: 'user-1',
        impersonationReason: 'support-debug',
      },
      user: {
        id: 'user-2',
        email: 'member@example.com',
        isPlatformAdmin: false,
        defaultWorkspaceId: 'workspace-1',
        displayName: 'Member',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo Workspace',
        slug: 'demo',
        kind: 'regular',
      },
      membership: {
        id: 'member-2',
        roleKey: 'member',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-2',
        roleKeys: ['member'],
        permissionScopes: ['workspace:read', 'knowledge_base:read'],
      },
    });
    mockStopImpersonation.mockResolvedValue({
      sessionToken: 'restored-token',
      user: {
        id: 'user-1',
        email: 'owner@example.com',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo Workspace',
      },
      membership: {
        id: 'member-1',
        roleKey: 'owner',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['owner'],
      },
    });
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-a',
        workspaceId: 'workspace-1',
        name: 'Alpha KB',
        defaultKbSnapshotId: null,
      },
    ]);

    await handler(req, res);

    expect(mockStopImpersonation).toHaveBeenCalled();
    expect(res.getHeader('Set-Cookie')).toContain(
      'wren_session=restored-token',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        runtimeSelector: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-a',
          kbSnapshotId: null,
          deployHash: null,
        },
      }),
    );
  });
});

export {};
