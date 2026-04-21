import {
  mockBuildAuthorizationActorFromValidatedSession,
  createReq,
  createRes,
  mockAddWorkspaceMember,
  mockCreatePrincipalRoleBinding,
  mockDeletePrincipalRoleBindingsByScope,
  mockGetUser,
  mockGetWorkspace,
  mockListWorkspaceMembers,
  mockListWorkspaces,
  mockListUsers,
  mockLogout,
  mockRegisterLocalUser,
  mockUpdateUser,
  mockValidateSession,
  platformAdminActor,
  platformAdminSession,
  resetPlatformApiTestEnv,
} from './platform_api.testSupport';

describe('platform users api routes', () => {
  beforeEach(() => {
    resetPlatformApiTestEnv();
  });

  it('GET /platform/users returns the platform user directory with workspace counts', async () => {
    const handler = (await import('../../pages/api/v1/platform/users/index'))
      .default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockListUsers.mockResolvedValue([
      {
        id: 'user-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        isPlatformAdmin: true,
        defaultWorkspaceId: 'workspace-1',
        status: 'active',
      },
      {
        id: 'user-2',
        email: 'viewer@example.com',
        displayName: 'Viewer',
        isPlatformAdmin: false,
        defaultWorkspaceId: null,
        status: 'active',
      },
    ]);
    mockListWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Alpha', status: 'active', kind: 'regular' },
      { id: 'workspace-2', name: 'Beta', status: 'active', kind: 'regular' },
    ]);
    mockListWorkspaceMembers.mockResolvedValue([
      {
        id: 'member-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        roleKey: 'owner',
        status: 'active',
      },
      {
        id: 'member-2',
        workspaceId: 'workspace-2',
        userId: 'user-1',
        roleKey: 'member',
        status: 'active',
      },
      {
        id: 'member-3',
        workspaceId: 'workspace-2',
        userId: 'user-2',
        roleKey: 'member',
        status: 'inactive',
      },
    ]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.platformRoleCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'platform_admin' }),
      ]),
    );
    expect(res.body.stats).toEqual({
      userCount: 2,
      platformAdminCount: 1,
      workspaceCount: 2,
    });
    expect(res.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'user-1',
          isPlatformAdmin: true,
          platformRoles: ['platform_admin'],
          platformRoleLabels: ['平台管理员'],
          defaultWorkspaceName: 'Alpha',
          workspaceCount: 2,
        }),
        expect.objectContaining({
          id: 'user-2',
          platformRoles: [],
          workspaceCount: 0,
        }),
      ]),
    );
  });

  it('GET /platform/users allows platform IAM admins with directory read permission', async () => {
    const handler = (await import('../../pages/api/v1/platform/users/index'))
      .default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      ...platformAdminSession,
      user: {
        ...platformAdminSession.user,
        isPlatformAdmin: false,
      },
      actorClaims: {
        ...platformAdminSession.actorClaims,
        isPlatformAdmin: false,
        platformRoleKeys: ['platform_iam_admin'],
        grantedActions: ['platform.user.read'],
      },
    });
    mockBuildAuthorizationActorFromValidatedSession.mockReturnValue({
      ...platformAdminActor,
      isPlatformAdmin: false,
      platformRoleKeys: ['platform_iam_admin'],
      grantedActions: ['platform.user.read'],
    });
    mockListUsers.mockResolvedValue([]);
    mockListWorkspaces.mockResolvedValue([]);
    mockListWorkspaceMembers.mockResolvedValue([]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.users).toEqual([]);
  });

  it('POST /platform/users/[id]/workspaces normalizes viewer to legacy member for service writes', async () => {
    const handler = (
      await import('../../pages/api/v1/platform/users/[id]/workspaces')
    ).default;
    const req = createReq({
      method: 'POST',
      query: { id: 'user-2' },
      body: { workspaceId: 'workspace-2', roleKey: 'viewer' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockGetUser.mockResolvedValueOnce({
      id: 'user-2',
      email: 'viewer@example.com',
      displayName: 'Viewer',
      isPlatformAdmin: false,
      defaultWorkspaceId: null,
      status: 'active',
    });
    mockListWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Alpha', status: 'active', kind: 'regular' },
      { id: 'workspace-2', name: 'Beta', status: 'active', kind: 'regular' },
    ]);
    mockListWorkspaceMembers.mockResolvedValue([
      {
        id: 'member-22',
        workspaceId: 'workspace-2',
        userId: 'user-2',
        roleKey: 'member',
        status: 'active',
      },
    ]);
    mockAddWorkspaceMember.mockResolvedValue({
      id: 'member-22',
      workspaceId: 'workspace-2',
      userId: 'user-2',
      roleKey: 'member',
      status: 'active',
    });
    mockGetWorkspace.mockResolvedValue({
      id: 'workspace-2',
      name: 'Beta',
      status: 'active',
      kind: 'regular',
    });

    await handler(req, res);

    expect(mockAddWorkspaceMember).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-2',
        userId: 'user-2',
        roleKey: 'member',
        status: 'active',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId: 'workspace-2',
          roleKey: 'viewer',
          rawRoleKey: 'member',
        }),
      ]),
    );
  });

  it('POST /platform/users creates a local user without replacing the current admin session', async () => {
    const handler = (await import('../../pages/api/v1/platform/users/index'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        email: 'new.user@example.com',
        password: 'password-123',
        displayName: 'New User',
      },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockRegisterLocalUser.mockResolvedValue({
      sessionToken: 'temporary-session',
      user: {
        id: 'user-9',
        email: 'new.user@example.com',
        displayName: 'New User',
        status: 'active',
        isPlatformAdmin: false,
        defaultWorkspaceId: null,
      },
    });
    mockLogout.mockResolvedValue(undefined);

    await handler(req, res);

    expect(mockRegisterLocalUser).toHaveBeenCalledWith({
      email: 'new.user@example.com',
      password: 'password-123',
      displayName: 'New User',
    });
    expect(mockLogout).toHaveBeenCalledWith('temporary-session');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body.user).toEqual(
      expect.objectContaining({
        id: 'user-9',
        email: 'new.user@example.com',
        displayName: 'New User',
      }),
    );
  });

  it('PATCH /platform/users/[id] syncs explicit platform roles and default workspace', async () => {
    const handler = (await import('../../pages/api/v1/platform/users/[id]'))
      .default;
    const req = createReq({
      method: 'PATCH',
      query: { id: 'user-1' },
      body: {
        displayName: 'Updated Owner',
        defaultWorkspaceId: 'workspace-1',
        platformRoleIds: ['role-platform-admin'],
      },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockGetUser.mockResolvedValueOnce(platformAdminSession.user);
    mockListWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Alpha', status: 'active', kind: 'regular' },
    ]);
    mockListWorkspaceMembers.mockResolvedValue([
      {
        id: 'member-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        roleKey: 'owner',
        status: 'active',
      },
    ]);
    mockUpdateUser.mockResolvedValue(undefined);
    mockGetUser.mockResolvedValueOnce({
      ...platformAdminSession.user,
      displayName: 'Updated Owner',
      isPlatformAdmin: true,
      defaultWorkspaceId: 'workspace-1',
    });

    await handler(req, res);

    expect(mockDeletePrincipalRoleBindingsByScope).toHaveBeenCalledWith(
      {
        principalType: 'user',
        principalId: 'user-1',
        scopeType: 'platform',
        scopeId: '',
      },
      expect.any(Object),
    );
    expect(mockCreatePrincipalRoleBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        principalType: 'user',
        principalId: 'user-1',
        roleId: 'role-platform-admin',
        scopeType: 'platform',
        scopeId: '',
      }),
      expect.any(Object),
    );
    expect(mockUpdateUser).toHaveBeenCalledWith(
      'user-1',
      {
        displayName: 'Updated Owner',
        defaultWorkspaceId: 'workspace-1',
        isPlatformAdmin: true,
      },
      expect.any(Object),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.user).toEqual(
      expect.objectContaining({
        isPlatformAdmin: true,
        platformRoles: ['platform_admin'],
        defaultWorkspaceId: 'workspace-1',
      }),
    );
  });
});
