import {
  createReq,
  createRes,
  mockListWorkspacesForUser,
  mockValidateSession,
} from './auth_api.testSupport';
import { resetAuthApiMocks } from './auth_api.testSupport';

describe('pages/api/auth routes', () => {
  beforeEach(() => {
    resetAuthApiMocks();
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
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
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

  it('returns a lightweight runtime selector for session refreshes', async () => {
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
    await handler(req, res);

    expect(res.body?.runtimeSelector).toEqual({
      workspaceId: 'workspace-1',
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
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
});

export {};
