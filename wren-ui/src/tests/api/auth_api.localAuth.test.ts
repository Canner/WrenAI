import {
  createReq,
  createRes,
  mockBootstrapOwner,
  mockChangeLocalPassword,
  mockEnforceRateLimit,
  mockFindAuthIdentity,
  mockLogin,
  mockLogout,
  mockRegisterLocalUser,
  mockValidateSession,
} from './auth_api.testSupport';
import { resetAuthApiMocks } from './auth_api.testSupport';

describe('pages/api/auth routes', () => {
  beforeEach(() => {
    resetAuthApiMocks();
  });

  it('bootstraps owner and sets session cookie', async () => {
    const handler = (await import('../../pages/api/auth/bootstrap')).default;
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
    const handler = (await import('../../pages/api/auth/login')).default;
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
    const handler = (await import('../../pages/api/auth/login')).default;
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
    const handler = (await import('../../pages/api/auth/login')).default;
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
    const handler = (await import('../../pages/api/auth/register')).default;
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
    const handler = (await import('../../pages/api/auth/logout')).default;
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
    const handler = (await import('../../pages/api/auth/password')).default;
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
    const handler = (await import('../../pages/api/auth/password')).default;
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
    const handler = (await import('../../pages/api/auth/password')).default;
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

  it('returns 429 when login attempts are rate limited', async () => {
    const handler = (await import('../../pages/api/auth/login')).default;
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
    const handler = (await import('../../pages/api/auth/session')).default;
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
    const handler = (await import('../../pages/api/auth/login')).default;
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
});

export {};
