import {
  createReq,
  createRes,
  mockFindResolvedRoleBindings,
  mockGetUser,
  mockListAllWorkspaces,
  mockListApiTokens,
  mockListDirectoryGroups,
  mockListKnowledgeBases,
  mockListServiceAccounts,
  mockListUsers,
  mockListWorkspaceMembers,
  mockListWorkspacesForUser,
  mockValidateSession,
  resetWorkspaceApiTestEnv,
  restoreWorkspaceApiTestEnv,
  sessionPayload,
} from './workspace_api.testSupport';

describe('workspace api routes', () => {
  beforeEach(() => {
    resetWorkspaceApiTestEnv();
  });

  afterAll(() => {
    restoreWorkspaceApiTestEnv();
  });

  it('returns binding explain details for members, groups, service accounts and tokens', async () => {
    const handler = (await import('../v1/workspace/current')).default;
    const req = createReq({
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockListWorkspacesForUser.mockResolvedValue([
      {
        id: 'workspace-1',
        name: 'Demo Workspace',
        kind: 'regular',
      },
    ]);
    mockListAllWorkspaces.mockResolvedValue([
      {
        id: 'workspace-1',
        name: 'Demo Workspace',
        slug: 'demo',
        status: 'active',
        kind: 'regular',
      },
    ]);
    mockListKnowledgeBases.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([]);
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
        workspaceId: 'workspace-1',
        userId: 'user-2',
        roleKey: 'admin',
        status: 'active',
      },
    ]);
    mockGetUser
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        status: 'active',
      })
      .mockResolvedValueOnce({
        id: 'user-2',
        email: 'member@example.com',
        displayName: 'Member',
        status: 'active',
      });
    mockListServiceAccounts.mockResolvedValue([
      {
        id: 'sa-1',
        workspaceId: 'workspace-1',
        name: 'Nightly Sync',
        roleKey: 'admin',
        status: 'active',
      },
    ]);
    mockListApiTokens.mockResolvedValue([
      {
        id: 'token-1',
        workspaceId: 'workspace-1',
        serviceAccountId: 'sa-1',
        name: 'Nightly Sync Token',
        prefix: 'tok',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        status: 'active',
      },
    ]);
    mockListDirectoryGroups.mockResolvedValue([
      {
        id: 'group-1',
        workspaceId: 'workspace-1',
        displayName: 'BI Admins',
        source: 'manual',
        status: 'active',
        roleKeys: ['workspace_admin'],
        members: [{ userId: 'user-2' }],
      },
    ]);
    mockFindResolvedRoleBindings.mockImplementation(
      async ({
        principalType,
        principalId,
        scopeType,
      }: {
        principalType: string;
        principalId: string;
        scopeType?: string;
      }) => {
        if (
          principalType === 'user' &&
          principalId === 'user-1' &&
          scopeType === 'workspace'
        ) {
          return [{ roleName: 'workspace_owner' }];
        }
        if (
          principalType === 'user' &&
          principalId === 'user-2' &&
          scopeType === 'workspace'
        ) {
          return [{ roleName: 'workspace_admin' }];
        }
        if (
          principalType === 'service_account' &&
          principalId === 'sa-1' &&
          scopeType === 'workspace'
        ) {
          return [{ roleName: 'workspace_admin' }];
        }
        if (
          principalType === 'user' &&
          principalId === 'user-1' &&
          scopeType === 'platform'
        ) {
          return [];
        }
        return [];
      },
    );

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.authorization.actor).toEqual(
      expect.objectContaining({
        workspaceSourceDetails: expect.arrayContaining([
          expect.objectContaining({
            kind: 'direct_binding',
            label: '直接绑定 · 所有者',
          }),
        ]),
        platformSourceDetails: [],
      }),
    );
    expect(res.body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'member-2',
          sourceDetails: expect.arrayContaining([
            expect.objectContaining({
              kind: 'direct_binding',
              label: '直接绑定 · 管理员',
            }),
            expect.objectContaining({
              kind: 'group_binding',
              label: '目录组 · BI Admins · 管理员',
            }),
          ]),
        }),
      ]),
    );
    expect(res.body.directoryGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'group-1',
          sourceDetails: expect.arrayContaining([
            expect.objectContaining({
              kind: 'group_binding',
              label: '目录组绑定 · 管理员',
            }),
          ]),
        }),
      ]),
    );
    expect(res.body.serviceAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sa-1',
          sourceDetails: expect.arrayContaining([
            expect.objectContaining({
              kind: 'service_account_binding',
              label: '服务账号绑定 · 管理员',
            }),
          ]),
        }),
      ]),
    );
    expect(res.body.apiTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'token-1',
          sourceDetails: expect.arrayContaining([
            expect.objectContaining({
              kind: 'token_binding',
              label: '继承服务账号 · Nightly Sync',
            }),
          ]),
        }),
      ]),
    );
  });

  it('does not expose legacy fallback source details when bindings are missing', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';

    const handler = (await import('../v1/workspace/current')).default;
    const req = createReq({
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      ...sessionPayload,
      actorClaims: {
        ...sessionPayload.actorClaims,
        roleKeys: ['owner'],
        isPlatformAdmin: false,
        platformRoleKeys: ['platform_admin'],
        grantedActions: ['workspace.read'],
        workspaceRoleSource: 'legacy',
        platformRoleSource: 'legacy',
      },
    });
    mockListWorkspacesForUser.mockResolvedValue([
      {
        id: 'workspace-1',
        name: 'Demo Workspace',
        kind: 'regular',
      },
    ]);
    mockListAllWorkspaces.mockResolvedValue([
      {
        id: 'workspace-1',
        name: 'Demo Workspace',
        slug: 'demo',
        status: 'active',
        kind: 'regular',
      },
    ]);
    mockListKnowledgeBases.mockResolvedValue([]);
    mockListWorkspaceMembers.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([]);
    mockFindResolvedRoleBindings.mockResolvedValue([]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.authorization.actor).toEqual(
      expect.objectContaining({
        workspaceSourceDetails: [],
        platformSourceDetails: [],
      }),
    );
  });

  it('owner candidates do not inherit legacy platform admin flags in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';

    const handler = (await import('../v1/workspace/current')).default;
    const req = createReq({
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      ...sessionPayload,
      actorClaims: {
        ...sessionPayload.actorClaims,
        isPlatformAdmin: false,
        platformRoleKeys: [],
        grantedActions: ['workspace.read', 'workspace.create'],
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'legacy',
      },
    });
    mockListWorkspacesForUser.mockResolvedValue([
      {
        id: 'workspace-1',
        name: 'Demo Workspace',
        kind: 'regular',
      },
    ]);
    mockListAllWorkspaces.mockResolvedValue([
      {
        id: 'workspace-1',
        name: 'Demo Workspace',
        slug: 'demo',
        status: 'active',
        kind: 'regular',
      },
    ]);
    mockListKnowledgeBases.mockResolvedValue([]);
    mockListWorkspaceMembers.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([
      {
        id: 'user-2',
        email: 'candidate@example.com',
        displayName: 'Candidate',
        status: 'active',
        isPlatformAdmin: true,
      },
    ]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.ownerCandidates).toEqual([
      expect.objectContaining({
        id: 'user-2',
        isPlatformAdmin: false,
      }),
    ]);
  });
});
