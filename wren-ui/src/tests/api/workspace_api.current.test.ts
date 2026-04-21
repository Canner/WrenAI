import {
  createReq,
  createRes,
  mockGetUser,
  mockListAllWorkspaces,
  mockListKnowledgeBases,
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

  it('returns workspace overview, access mode, permissions and review queue', async () => {
    const handler = (await import('../../pages/api/v1/workspace/current'))
      .default;
    const req = createReq({
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockListWorkspacesForUser.mockResolvedValue([
      {
        id: 'workspace-2',
        name: 'Beta Workspace',
        kind: 'regular',
      },
      {
        id: 'workspace-1',
        name: 'Demo Workspace',
        slug: 'demo',
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
      {
        id: 'workspace-2',
        name: 'Beta Workspace',
        slug: 'beta',
        status: 'active',
        kind: 'regular',
      },
      {
        id: 'workspace-3',
        name: 'Invite Workspace',
        slug: 'invite',
        status: 'active',
        kind: 'regular',
      },
      {
        id: 'workspace-default',
        name: '系统样例空间',
        slug: 'system-samples',
        status: 'active',
        kind: 'default',
      },
    ]);
    mockListKnowledgeBases.mockResolvedValue([
      { id: 'kb-1', archivedAt: null },
      { id: 'kb-2', archivedAt: null },
    ]);
    mockListWorkspaceMembers
      .mockResolvedValueOnce([
        {
          id: 'member-2',
          workspaceId: 'workspace-1',
          userId: 'user-2',
          roleKey: 'member',
          status: 'pending',
        },
        {
          id: 'member-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          roleKey: 'owner',
          status: 'active',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'member-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          roleKey: 'owner',
          status: 'active',
          updatedAt: '2026-04-09T00:00:00.000Z',
        },
        {
          id: 'member-9',
          workspaceId: 'workspace-9',
          userId: 'user-1',
          roleKey: 'member',
          status: 'rejected',
          updatedAt: '2026-04-08T00:00:00.000Z',
        },
      ]);
    mockGetUser
      .mockResolvedValueOnce({
        id: 'user-2',
        email: 'member@example.com',
        displayName: 'Member',
        status: 'active',
      })
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        status: 'active',
      });
    mockListUsers.mockResolvedValue([
      {
        id: 'user-2',
        email: 'member@example.com',
        displayName: 'Member',
        status: 'active',
        isPlatformAdmin: false,
      },
      {
        id: 'user-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        status: 'active',
        isPlatformAdmin: true,
      },
    ]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      user: expect.objectContaining({
        id: 'user-1',
        isPlatformAdmin: true,
        defaultWorkspaceId: 'workspace-1',
      }),
      isPlatformAdmin: true,
      defaultWorkspaceId: 'workspace-1',
      workspace: expect.objectContaining({
        id: 'workspace-1',
        kind: 'regular',
      }),
      membership: { id: 'member-1', roleKey: 'owner' },
      permissions: {
        canManageMembers: true,
        canInviteMembers: true,
        canApproveMembers: true,
        canManageSchedules: true,
        canCreateWorkspace: true,
        actions: expect.objectContaining({
          'workspace.create': true,
          'workspace.default.set': true,
          'workspace.member.invite': true,
          'workspace.member.approve': true,
          'workspace.member.status.update': true,
          'workspace.member.role.update': true,
          'workspace.member.remove': true,
          'workspace.schedule.manage': true,
          'knowledge_base.create': true,
          'connector.create': true,
          'skill.create': true,
          'secret.reencrypt': true,
        }),
      },
      authorization: {
        actor: expect.objectContaining({
          principalType: 'user',
          principalId: 'user-1',
          workspaceId: 'workspace-1',
          workspaceMemberId: 'member-1',
          workspaceRoleKeys: ['owner'],
          permissionScopes: ['workspace:*', 'knowledge_base:*'],
          isPlatformAdmin: true,
          platformRoleKeys: ['platform_admin'],
        }),
      },
      workspaces: expect.arrayContaining([
        expect.objectContaining({ id: 'workspace-1', kind: 'regular' }),
        expect.objectContaining({ id: 'workspace-2', kind: 'regular' }),
      ]),
      discoverableWorkspaces: expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace-2',
          kind: 'regular',
        }),
        expect.objectContaining({
          id: 'workspace-3',
          kind: 'regular',
        }),
      ]),
      applications: [
        expect.objectContaining({
          workspaceId: 'workspace-9',
          status: 'rejected',
          kind: 'regular',
        }),
      ],
      ownerCandidates: [
        expect.objectContaining({
          id: 'user-2',
          email: 'member@example.com',
        }),
        expect.objectContaining({
          id: 'user-1',
          email: 'owner@example.com',
          isPlatformAdmin: false,
        }),
      ],
      serviceAccounts: [],
      apiTokens: [],
      identityProviders: [],
      accessReviews: [],
      directoryGroups: [],
      breakGlassGrants: [],
      impersonation: {
        active: false,
        impersonatorUserId: null,
        reason: null,
        canStop: false,
      },
      reviewQueue: [
        expect.objectContaining({
          id: 'member-2',
          status: 'pending',
        }),
      ],
      stats: {
        workspaceCount: 2,
        knowledgeBaseCount: 2,
        memberCount: 2,
        reviewQueueCount: 1,
        serviceAccountCount: 0,
        enterpriseSsoCount: 0,
        accessReviewCount: 0,
        directoryGroupCount: 0,
        breakGlassGrantCount: 0,
      },
      members: [
        expect.objectContaining({
          id: 'member-1',
          roleKey: 'owner',
        }),
        expect.objectContaining({
          id: 'member-2',
          status: 'pending',
        }),
      ],
    });
  });

  it('returns 403 when workspace overview read is not granted', async () => {
    const handler = (await import('../../pages/api/v1/workspace/current'))
      .default;
    const req = createReq({
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      ...sessionPayload,
      actorClaims: {
        ...sessionPayload.actorClaims,
        workspaceRoleSource: 'role_binding',
        grantedActions: [],
        isPlatformAdmin: false,
        platformRoleKeys: [],
      },
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({
      error: 'Workspace read permission required',
    });
  });

  it('normalizes workspace overview platform admin from actorClaims instead of legacy user flags', async () => {
    const handler = (await import('../../pages/api/v1/workspace/current'))
      .default;
    const req = createReq({
      query: { workspaceId: 'workspace-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      ...sessionPayload,
      user: {
        ...sessionPayload.user,
        isPlatformAdmin: true,
      },
      actorClaims: {
        ...sessionPayload.actorClaims,
        isPlatformAdmin: false,
        platformRoleKeys: [],
        grantedActions: ['workspace.read'],
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'role_binding',
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

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          id: 'user-1',
          isPlatformAdmin: false,
        }),
        isPlatformAdmin: false,
        authorization: {
          actor: expect.objectContaining({
            isPlatformAdmin: false,
            platformRoleKeys: [],
            platformRoleSource: 'role_binding',
          }),
        },
      }),
    );
  });
});
