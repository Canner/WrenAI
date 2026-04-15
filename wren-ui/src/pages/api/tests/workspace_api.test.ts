export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockValidateSession = jest.fn();
const mockListWorkspacesForUser = jest.fn();
const mockAddWorkspaceMember = jest.fn();
const mockGetMembership = jest.fn();
const mockInviteWorkspaceMemberByEmail = jest.fn();
const mockUpdateWorkspaceMember = jest.fn();
const mockRemoveWorkspaceMember = jest.fn();
const mockApplyToWorkspace = jest.fn();
const mockAcceptInvitation = jest.fn();
const mockCreateWorkspace = jest.fn();
const mockUpdateDefaultWorkspace = jest.fn();
const mockListKnowledgeBases = jest.fn();
const mockListWorkspaceMembers = jest.fn();
const mockFindWorkspaceMember = jest.fn();
const mockGetUser = jest.fn();
const mockListUsers = jest.fn();
const mockGetSessionTokenFromRequest = jest.fn();
const mockListAllWorkspaces = jest.fn();
const mockFindWorkspace = jest.fn();
const mockCreateAuditEvent = jest.fn();
const mockListServiceAccounts = jest.fn();
const mockListApiTokens = jest.fn();
const mockListIdentityProviders = jest.fn();
const mockListAccessReviews = jest.fn();
const mockListDirectoryGroups = jest.fn();
const mockListBreakGlassGrants = jest.fn();
const mockFindResolvedRoleBindings = jest.fn();

jest.mock('@/common', () => ({
  components: {
    authService: {
      validateSession: mockValidateSession,
    },
    workspaceService: {
      listWorkspacesForUser: mockListWorkspacesForUser,
      addMember: mockAddWorkspaceMember,
      getMembership: mockGetMembership,
      inviteMemberByEmail: mockInviteWorkspaceMemberByEmail,
      updateMember: mockUpdateWorkspaceMember,
      removeMember: mockRemoveWorkspaceMember,
      applyToWorkspace: mockApplyToWorkspace,
      acceptInvitation: mockAcceptInvitation,
      createWorkspace: mockCreateWorkspace,
      updateDefaultWorkspace: mockUpdateDefaultWorkspace,
    },
    knowledgeBaseRepository: {
      findAllBy: mockListKnowledgeBases,
    },
    workspaceMemberRepository: {
      findAllBy: mockListWorkspaceMembers,
      findOneBy: mockFindWorkspaceMember,
    },
    workspaceRepository: {
      findAllBy: mockListAllWorkspaces,
      findOneBy: mockFindWorkspace,
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
    principalRoleBindingRepository: {
      findResolvedRoleBindings: mockFindResolvedRoleBindings,
    },
    automationService: {
      listServiceAccounts: mockListServiceAccounts,
      listApiTokens: mockListApiTokens,
    },
    identityProviderService: {
      listProviders: mockListIdentityProviders,
    },
    governanceService: {
      listAccessReviews: mockListAccessReviews,
      listDirectoryGroups: mockListDirectoryGroups,
      listBreakGlassGrants: mockListBreakGlassGrants,
    },
    userRepository: {
      findOneBy: mockGetUser,
      findAllBy: mockListUsers,
    },
  },
}));

jest.mock('@server/context/actorClaims', () => ({
  getSessionTokenFromRequest: (...args: any[]) =>
    mockGetSessionTokenFromRequest(...args),
}));

describe('workspace api routes', () => {
  const ownerGrantedActions = [
    'workspace.read',
    'workspace.create',
    'workspace.default.set',
    'workspace.member.invite',
    'workspace.member.approve',
    'workspace.member.reject',
    'workspace.member.status.update',
    'workspace.member.remove',
    'workspace.member.role.update',
    'workspace.schedule.manage',
    'knowledge_base.create',
    'connector.create',
    'skill.create',
    'secret.reencrypt',
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
    'break_glass.manage',
    'impersonation.start',
  ];

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

  const sessionPayload = {
    workspace: {
      id: 'workspace-1',
      name: 'Demo Workspace',
      slug: 'demo',
      kind: 'regular',
    },
    membership: { id: 'member-1', roleKey: 'owner' },
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      isPlatformAdmin: true,
      defaultWorkspaceId: 'workspace-1',
      displayName: 'Owner',
    },
    session: {
      id: 'session-1',
    },
    actorClaims: {
      workspaceId: 'workspace-1',
      workspaceMemberId: 'member-1',
      roleKeys: ['owner'],
      permissionScopes: ['workspace:*', 'knowledge_base:*'],
      grantedActions: ownerGrantedActions,
      workspaceRoleSource: 'role_binding',
      isPlatformAdmin: true,
      platformRoleKeys: ['platform_admin'],
      platformRoleSource: 'role_binding',
    },
  };

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
    mockGetSessionTokenFromRequest.mockReturnValue('session-token');
    mockValidateSession.mockResolvedValue(sessionPayload);
    mockListServiceAccounts.mockResolvedValue([]);
    mockListApiTokens.mockResolvedValue([]);
    mockListIdentityProviders.mockResolvedValue([]);
    mockListAccessReviews.mockResolvedValue([]);
    mockListDirectoryGroups.mockResolvedValue([]);
    mockListBreakGlassGrants.mockResolvedValue([]);
    mockFindResolvedRoleBindings.mockResolvedValue([]);
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('returns workspace overview, access mode, permissions and review queue', async () => {
    const handler = (await import('../v1/workspace/current')).default;
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
    const handler = (await import('../v1/workspace/current')).default;
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
