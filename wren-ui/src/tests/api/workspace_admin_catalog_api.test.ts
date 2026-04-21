export {};

const mockValidateSession = jest.fn();
const mockGetSessionTokenFromRequest = jest.fn();

const mockAssertAuthorizedWithAudit = jest.fn();
const mockBuildAuthorizationActorFromValidatedSession = jest.fn();
const mockBuildAuthorizationContextFromRequest = jest.fn();
const mockListWorkspaceRoleCatalog = jest.fn();
const mockListWorkspaceRoleBindings = jest.fn();
const mockCreateCustomWorkspaceRole = jest.fn();
const mockUpdateCustomWorkspaceRole = jest.fn();
const mockDeleteCustomWorkspaceRole = jest.fn();
const mockCreateWorkspaceRoleBinding = jest.fn();
const mockDeleteWorkspaceRoleBinding = jest.fn();
const mockSearchWorkspaceAuditEvents = jest.fn();
const mockExplainWorkspaceAuthorization = jest.fn();
const mockRecordAuditEvent = jest.fn();

jest.mock('@/common', () => ({
  components: {
    authService: {
      validateSession: mockValidateSession,
    },
    auditEventRepository: {
      createOne: jest.fn(),
    },
    roleRepository: {},
    permissionRepository: {},
    rolePermissionRepository: {},
    principalRoleBindingRepository: {},
    userRepository: {},
    workspaceMemberRepository: {},
    directoryGroupRepository: {},
    directoryGroupMemberRepository: {},
    serviceAccountRepository: {},
  },
}));

jest.mock('@server/context/actorClaims', () => ({
  getSessionTokenFromRequest: (...args: any[]) =>
    mockGetSessionTokenFromRequest(...args),
}));

jest.mock('@server/authz', () => ({
  assertAuthorizedWithAudit: (...args: any[]) =>
    mockAssertAuthorizedWithAudit(...args),
  buildAuthorizationActorFromValidatedSession: (...args: any[]) =>
    mockBuildAuthorizationActorFromValidatedSession(...args),
  buildAuthorizationContextFromRequest: (...args: any[]) =>
    mockBuildAuthorizationContextFromRequest(...args),
  listWorkspaceRoleCatalog: (...args: any[]) =>
    mockListWorkspaceRoleCatalog(...args),
  listWorkspaceRoleBindings: (...args: any[]) =>
    mockListWorkspaceRoleBindings(...args),
  createCustomWorkspaceRole: (...args: any[]) =>
    mockCreateCustomWorkspaceRole(...args),
  updateCustomWorkspaceRole: (...args: any[]) =>
    mockUpdateCustomWorkspaceRole(...args),
  deleteCustomWorkspaceRole: (...args: any[]) =>
    mockDeleteCustomWorkspaceRole(...args),
  createWorkspaceRoleBinding: (...args: any[]) =>
    mockCreateWorkspaceRoleBinding(...args),
  deleteWorkspaceRoleBinding: (...args: any[]) =>
    mockDeleteWorkspaceRoleBinding(...args),
  searchWorkspaceAuditEvents: (...args: any[]) =>
    mockSearchWorkspaceAuditEvents(...args),
  explainWorkspaceAuthorization: (...args: any[]) =>
    mockExplainWorkspaceAuthorization(...args),
  recordAuditEvent: (...args: any[]) => mockRecordAuditEvent(...args),
}));

describe('workspace admin catalog api routes', () => {
  const sessionPayload = {
    workspace: {
      id: 'workspace-1',
      name: 'Demo Workspace',
      kind: 'regular',
    },
    membership: { id: 'member-1', roleKey: 'owner' },
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      isPlatformAdmin: false,
    },
    session: { id: 'session-1' },
    actorClaims: {
      workspaceId: 'workspace-1',
      workspaceMemberId: 'member-1',
      roleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      grantedActions: ['role.read', 'role.manage', 'audit.read'],
      workspaceRoleSource: 'role_binding',
      platformRoleSource: 'role_binding',
    },
  };

  const actor = {
    principalType: 'user',
    principalId: 'user-1',
    workspaceId: 'workspace-1',
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:*'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
    grantedActions: ['role.read', 'role.manage', 'audit.read'],
    workspaceRoleSource: 'role_binding',
    platformRoleSource: 'role_binding',
    sessionId: 'session-1',
  };

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

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSessionTokenFromRequest.mockReturnValue('session-token');
    mockValidateSession.mockResolvedValue(sessionPayload);
    mockBuildAuthorizationActorFromValidatedSession.mockReturnValue(actor);
    mockBuildAuthorizationContextFromRequest.mockReturnValue({
      requestId: 'req-1',
      sessionId: 'session-1',
    });
    mockAssertAuthorizedWithAudit.mockResolvedValue({ allowed: true });
    mockRecordAuditEvent.mockResolvedValue(undefined);
  });

  it('GET /workspace/roles returns catalog and bindings', async () => {
    const handler = (await import('../../pages/api/v1/workspace/roles/index'))
      .default;
    const req = createReq({
      method: 'GET',
      query: { workspaceId: 'workspace-1' },
    });
    const res = createRes();

    mockListWorkspaceRoleCatalog.mockResolvedValue({
      roles: [{ id: 'role-1', name: 'workspace_admin', isActive: true }],
      permissionCatalog: [],
      actionCatalog: [],
    });
    mockListWorkspaceRoleBindings.mockResolvedValue([
      { id: 'binding-1', principalType: 'user', principalId: 'user-1' },
    ]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.roles).toEqual([
      { id: 'role-1', name: 'workspace_admin', isActive: true },
    ]);
    expect(res.body.bindings).toHaveLength(1);
  });

  it('POST /workspace/roles creates custom role', async () => {
    const handler = (await import('../../pages/api/v1/workspace/roles/index'))
      .default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        name: 'data_steward',
        displayName: 'Data Steward',
        description: 'custom role',
        permissionNames: ['knowledge_base.read'],
        isActive: true,
      },
    });
    const res = createRes();

    mockCreateCustomWorkspaceRole.mockResolvedValue({
      id: 'role-custom-1',
      name: 'workspace_custom_role:workspace-1:data_steward',
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreateCustomWorkspaceRole).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        name: 'data_steward',
        displayName: 'Data Steward',
        isActive: true,
      }),
    );
  });

  it('PATCH /workspace/roles/:id updates visible role metadata', async () => {
    const handler = (await import('../../pages/api/v1/workspace/roles/[id]'))
      .default;
    const req = createReq({
      method: 'PATCH',
      query: { workspaceId: 'workspace-1', id: 'role-custom-1' },
      body: {
        name: 'finance_admin',
        displayName: 'Finance Admin',
        isActive: false,
        permissionNames: ['knowledge_base.read'],
      },
    });
    const res = createRes();

    mockUpdateCustomWorkspaceRole.mockResolvedValue({
      id: 'role-custom-1',
      name: 'finance_admin',
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockUpdateCustomWorkspaceRole).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        roleId: 'role-custom-1',
        name: 'finance_admin',
        displayName: 'Finance Admin',
        isActive: false,
      }),
    );
  });

  it('POST /workspace/role-bindings creates role binding', async () => {
    const handler = (
      await import('../../pages/api/v1/workspace/role-bindings/index')
    ).default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        principalType: 'user',
        principalId: 'user-2',
        roleId: 'role-custom-1',
      },
    });
    const res = createRes();

    mockCreateWorkspaceRoleBinding.mockResolvedValue({ id: 'binding-2' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreateWorkspaceRoleBinding).toHaveBeenCalled();
  });

  it('GET /workspace/audit-events returns events', async () => {
    const handler = (
      await import('../../pages/api/v1/workspace/audit-events/index')
    ).default;
    const req = createReq({
      method: 'GET',
      query: { workspaceId: 'workspace-1', result: 'denied' },
    });
    const res = createRes();

    mockSearchWorkspaceAuditEvents.mockResolvedValue([
      { id: 'audit-1', action: 'workspace.member.invite', result: 'denied' },
    ]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.events).toHaveLength(1);
  });

  it('POST /workspace/authorization/explain returns authorization explanation', async () => {
    const handler = (
      await import('../../pages/api/v1/workspace/authorization/explain')
    ).default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        principalType: 'user',
        principalId: 'user-2',
        action: 'knowledge_base.update',
      },
    });
    const res = createRes();

    mockExplainWorkspaceAuthorization.mockResolvedValue({
      principalType: 'user',
      principalId: 'user-2',
      allowed: false,
      reasons: ['missing role.manage'],
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        principalType: 'user',
        principalId: 'user-2',
      }),
    );
  });

  it('returns 403 when role management is denied', async () => {
    const handler = (await import('../../pages/api/v1/workspace/roles/index'))
      .default;
    const req = createReq({
      method: 'POST',
      query: { workspaceId: 'workspace-1' },
      body: {
        displayName: 'Denied Role',
      },
    });
    const res = createRes();

    const err: any = new Error('Role management permission required');
    err.statusCode = 403;
    mockAssertAuthorizedWithAudit.mockRejectedValueOnce(err);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockCreateCustomWorkspaceRole).not.toHaveBeenCalled();
  });
});
