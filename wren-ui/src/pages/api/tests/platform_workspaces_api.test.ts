import {
  mockBuildAuthorizationActorFromValidatedSession,
  createReq,
  createRes,
  mockCreateWorkspace,
  mockGetWorkspace,
  mockGetWorkspaceMember,
  mockListConnectors,
  mockListKnowledgeBases,
  mockListSkills,
  mockListUsers,
  mockListWorkspaceMembers,
  mockListWorkspaces,
  mockListWorkspacesForUser,
  mockValidateSession,
  mockUpdateWorkspaceMember,
  platformAdminActor,
  platformAdminSession,
  resetPlatformApiTestEnv,
} from './platform_api.testSupport';

describe('platform workspaces api routes', () => {
  beforeEach(() => {
    resetPlatformApiTestEnv();
  });

  it('GET /platform/workspaces returns workspace governance overview and pending applications', async () => {
    const handler = (await import('../v1/platform/workspaces/index')).default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockListWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Alpha', status: 'active', kind: 'regular' },
      { id: 'workspace-2', name: 'Beta', status: 'active', kind: 'regular' },
    ]);
    mockListWorkspacesForUser.mockResolvedValue([
      { id: 'workspace-1', name: 'Alpha', kind: 'regular' },
    ]);
    mockListUsers.mockResolvedValue([
      {
        id: 'user-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        status: 'active',
      },
      {
        id: 'user-2',
        email: 'viewer@example.com',
        displayName: 'Viewer',
        status: 'active',
      },
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
        workspaceId: 'workspace-1',
        userId: 'user-2',
        roleKey: 'member',
        status: 'pending',
      },
    ]);
    mockListKnowledgeBases.mockResolvedValue([
      { id: 'kb-1', archivedAt: null },
    ]);
    mockListConnectors.mockResolvedValue([{ id: 'connector-1' }]);
    mockListSkills.mockResolvedValue([{ id: 'skill-1' }]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace-1',
          ownerCount: 1,
          viewerCount: 0,
          pendingCount: 1,
          canManageMembers: true,
          resourceSummary: {
            knowledgeBaseCount: 1,
            connectorCount: 1,
            skillCount: 1,
          },
        }),
      ]),
    );
    expect(res.body.applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'member-2',
          roleKey: 'viewer',
          status: 'pending',
        }),
      ]),
    );
    expect(res.body.ownerCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'user-1' }),
        expect.objectContaining({ id: 'user-2' }),
      ]),
    );
  });

  it('POST /platform/workspaces creates a workspace for platform admins', async () => {
    const handler = (await import('../v1/platform/workspaces/index')).default;
    const req = createReq({
      method: 'POST',
      body: {
        name: 'Ops Workspace',
        slug: 'ops',
        initialOwnerUserId: 'user-2',
      },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockCreateWorkspace.mockResolvedValue({
      id: 'workspace-9',
      name: 'Ops Workspace',
      slug: 'ops',
      kind: 'regular',
      status: 'active',
    });
    mockListWorkspaces.mockResolvedValue([]);
    mockListWorkspaceMembers.mockResolvedValue([]);
    mockListWorkspacesForUser.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([]);

    await handler(req, res);

    expect(mockCreateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ops Workspace',
        slug: 'ops',
        initialOwnerUserId: 'user-2',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('POST /platform/workspaces also allows platform workspace admins with workspace.create', async () => {
    const handler = (await import('../v1/platform/workspaces/index')).default;
    const req = createReq({
      method: 'POST',
      body: {
        name: 'Data Ops Workspace',
        slug: 'data-ops',
        initialOwnerUserId: 'user-2',
      },
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
        platformRoleKeys: ['platform_workspace_admin'],
        grantedActions: [
          'platform.workspace.read',
          'workspace.create',
          'platform.workspace.member.manage',
        ],
      },
    });
    mockBuildAuthorizationActorFromValidatedSession.mockReturnValue({
      ...platformAdminActor,
      isPlatformAdmin: false,
      platformRoleKeys: ['platform_workspace_admin'],
      grantedActions: [
        'platform.workspace.read',
        'workspace.create',
        'platform.workspace.member.manage',
      ],
    });
    mockCreateWorkspace.mockResolvedValue({
      id: 'workspace-10',
      name: 'Data Ops Workspace',
      slug: 'data-ops',
      kind: 'regular',
      status: 'active',
    });
    mockListWorkspaces.mockResolvedValue([]);
    mockListWorkspaceMembers.mockResolvedValue([]);
    mockListWorkspacesForUser.mockResolvedValue([]);
    mockListUsers.mockResolvedValue([]);

    await handler(req, res);

    expect(mockCreateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Data Ops Workspace',
        slug: 'data-ops',
        initialOwnerUserId: 'user-2',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('PATCH /platform/workspaces/[id]/members/[memberId] normalizes viewer updates back to legacy member', async () => {
    const handler = (
      await import('../v1/platform/workspaces/[id]/members/[memberId]')
    ).default;
    const req = createReq({
      method: 'PATCH',
      query: { id: 'workspace-1', memberId: 'member-2' },
      body: { action: 'updateRole', roleKey: 'viewer' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockGetWorkspace.mockResolvedValue({
      id: 'workspace-1',
      name: 'Alpha',
      status: 'active',
      kind: 'regular',
    });
    mockGetWorkspaceMember.mockResolvedValue({
      id: 'member-2',
      workspaceId: 'workspace-1',
      userId: 'user-2',
      roleKey: 'owner',
      status: 'active',
    });
    mockUpdateWorkspaceMember.mockResolvedValue({
      id: 'member-2',
      workspaceId: 'workspace-1',
      userId: 'user-2',
      roleKey: 'member',
      status: 'active',
    });

    await handler(req, res);

    expect(mockUpdateWorkspaceMember).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        memberId: 'member-2',
        roleKey: 'member',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
