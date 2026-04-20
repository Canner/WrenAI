import {
  createReq,
  createRes,
  mockAcceptInvitation,
  mockAddWorkspaceMember,
  mockApplyToWorkspace,
  mockCreateWorkspace,
  mockFindWorkspace,
  mockFindWorkspaceMember,
  mockInviteWorkspaceMemberByEmail,
  mockUpdateDefaultWorkspace,
  mockUpdateWorkspaceMember,
  resetWorkspaceApiTestEnv,
  restoreWorkspaceApiTestEnv,
} from './workspace_api.testSupport';

describe('workspace api routes', () => {
  beforeEach(() => {
    resetWorkspaceApiTestEnv();
  });

  afterAll(() => {
    restoreWorkspaceApiTestEnv();
  });

  it('submits a pending application for request-only workspaces', async () => {
    const handler = (await import('../v1/workspace/apply')).default;
    const req = createReq({
      method: 'POST',
      body: { workspaceId: 'workspace-3' },
    });
    const res = createRes();

    mockFindWorkspace.mockResolvedValue({
      id: 'workspace-3',
      status: 'active',
      kind: 'regular',
    });
    mockApplyToWorkspace.mockResolvedValue({
      id: 'member-3',
      workspaceId: 'workspace-3',
      userId: 'user-1',
      roleKey: 'member',
      status: 'pending',
    });

    await handler(req, res);

    expect(mockApplyToWorkspace).toHaveBeenCalledWith({
      workspaceId: 'workspace-3',
      userId: 'user-1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.membership.status).toBe('pending');
  });

  it('activates invited memberships through join route', async () => {
    const handler = (await import('../v1/workspace/join')).default;
    const req = createReq({
      method: 'POST',
      body: { workspaceId: 'workspace-3' },
    });
    const res = createRes();

    mockFindWorkspace.mockResolvedValue({
      id: 'workspace-3',
      status: 'active',
      kind: 'regular',
    });
    mockAcceptInvitation.mockResolvedValue({
      id: 'member-3',
      workspaceId: 'workspace-3',
      userId: 'user-1',
      roleKey: 'member',
      status: 'invited',
    });
    mockAddWorkspaceMember.mockResolvedValue({
      id: 'member-3',
      workspaceId: 'workspace-3',
      userId: 'user-1',
      roleKey: 'member',
      status: 'active',
    });

    await handler(req, res);

    expect(mockAcceptInvitation).toHaveBeenCalledWith({
      workspaceId: 'workspace-3',
      userId: 'user-1',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('invites a member by email for managers', async () => {
    const handler = (await import('../v1/workspace/members/index')).default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: { email: 'member@example.com', roleKey: 'admin' },
    });
    const res = createRes();

    mockInviteWorkspaceMemberByEmail.mockResolvedValue({
      id: 'member-2',
      workspaceId: 'workspace-1',
      userId: 'user-2',
      roleKey: 'admin',
      status: 'invited',
    });

    await handler(req, res);

    expect(mockInviteWorkspaceMemberByEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        email: 'member@example.com',
        roleKey: 'admin',
        status: 'invited',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('creates a workspace for platform admins', async () => {
    const handler = (await import('../v1/workspace')).default;
    const req = createReq({
      method: 'POST',
      body: { name: 'Ops', initialOwnerUserId: 'user-1' },
    });
    const res = createRes();

    mockCreateWorkspace.mockResolvedValue({
      id: 'workspace-ops',
      name: 'Ops',
      slug: 'ops',
      kind: 'regular',
      status: 'active',
    });

    await handler(req, res);

    expect(mockCreateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ops',
        slug: undefined,
        createdBy: 'user-1',
        initialOwnerUserId: 'user-1',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('updates default workspace preference', async () => {
    const handler = (await import('../v1/workspace/preferences')).default;
    const req = createReq({
      method: 'PATCH',
      body: { defaultWorkspaceId: 'workspace-2' },
    });
    const res = createRes();
    mockFindWorkspace.mockResolvedValue({
      id: 'workspace-2',
      name: 'Beta Workspace',
      slug: 'beta',
      kind: 'regular',
    });

    await handler(req, res);

    expect(mockUpdateDefaultWorkspace).toHaveBeenCalledWith({
      validatedSession: expect.objectContaining({
        user: expect.objectContaining({ id: 'user-1' }),
        workspace: expect.objectContaining({ id: 'workspace-1' }),
      }),
      defaultWorkspaceId: 'workspace-2',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('approves a pending member request', async () => {
    const handler = (await import('../v1/workspace/members/[id]')).default;
    const req = createReq({
      method: 'PATCH',
      query: { workspaceId: 'workspace-1', id: 'member-2' },
      body: { action: 'approve' },
    });
    const res = createRes();

    mockFindWorkspaceMember.mockResolvedValue({
      id: 'member-2',
      workspaceId: 'workspace-1',
      userId: 'user-2',
      roleKey: 'member',
      status: 'pending',
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
        roleKey: undefined,
        status: 'active',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
