const mockBootstrapOwner = jest.fn();
const mockLogin = jest.fn();
const mockLogout = jest.fn();
const mockValidateSession = jest.fn();
const mockListWorkspacesForUser = jest.fn();

jest.mock('@/common', () => ({
  components: {
    authService: {
      bootstrapOwner: mockBootstrapOwner,
      login: mockLogin,
      logout: mockLogout,
      validateSession: mockValidateSession,
    },
    workspaceService: {
      listWorkspacesForUser: mockListWorkspacesForUser,
    },
  },
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
      getHeader: (key: string) => headers[key],
    };
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bootstraps owner and sets session cookie', async () => {
    const handler = (await import('../auth/bootstrap')).default;
    const req = createReq({
      method: 'POST',
      body: {
        email: 'owner@example.com',
        password: 'secret',
        displayName: 'Owner',
        workspaceName: 'Demo Workspace',
      },
    });
    const res = createRes();

    mockBootstrapOwner.mockResolvedValue({
      sessionToken: 'bootstrap-token',
      user: { id: 'user-1', email: 'owner@example.com' },
      workspace: { id: 'workspace-1', name: 'Demo Workspace' },
      membership: { id: 'member-1', roleKey: 'owner' },
      actorClaims: { workspaceId: 'workspace-1', roleKeys: ['owner'] },
    });

    await handler(req, res);

    expect(mockBootstrapOwner).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'secret',
      displayName: 'Owner',
      workspaceName: 'Demo Workspace',
      workspaceSlug: undefined,
      locale: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.getHeader('Set-Cookie')).toContain('wren_session=bootstrap-token');
    expect(res.body).toEqual(
      expect.objectContaining({
        user: { id: 'user-1', email: 'owner@example.com' },
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
      user: { id: 'user-1', email: 'member@example.com' },
      workspace: { id: 'workspace-1', name: 'Demo' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: { workspaceId: 'workspace-1', roleKeys: ['member'] },
    });

    await handler(req, res);

    expect(mockLogin).toHaveBeenCalledWith({
      email: 'member@example.com',
      password: 'passw0rd',
      workspaceId: 'workspace-1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.getHeader('Set-Cookie')).toContain('wren_session=login-token');
    expect(res.body).toEqual(
      expect.objectContaining({
        workspace: { id: 'workspace-1', name: 'Demo' },
      }),
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
      user: { id: 'user-1', email: 'member@example.com' },
      workspace: { id: 'workspace-1', name: 'Demo' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: { workspaceId: 'workspace-1', roleKeys: ['member'] },
    });
    mockListWorkspacesForUser.mockResolvedValue([
      { id: 'workspace-1', name: 'Demo' },
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
      user: { id: 'user-1', email: 'member@example.com' },
      workspace: { id: 'workspace-1', name: 'Demo' },
      membership: { id: 'member-1', roleKey: 'member' },
      actorClaims: { workspaceId: 'workspace-1', roleKeys: ['member'] },
      workspaces: [{ id: 'workspace-1', name: 'Demo' }],
      session: {
        id: 'session-1',
        expiresAt: '2026-04-10T00:00:00.000Z',
        lastSeenAt: '2026-04-03T00:00:00.000Z',
      },
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
      actorClaims: { workspaceId: 'workspace-1', roleKeys: ['member'] },
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.getHeader('Set-Cookie')).toContain('Secure');
  });
});

export {};
