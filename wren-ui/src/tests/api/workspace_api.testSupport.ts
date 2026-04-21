const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

export const mockValidateSession = jest.fn();
export const mockListWorkspacesForUser = jest.fn();
export const mockAddWorkspaceMember = jest.fn();
export const mockGetMembership = jest.fn();
export const mockInviteWorkspaceMemberByEmail = jest.fn();
export const mockUpdateWorkspaceMember = jest.fn();
export const mockRemoveWorkspaceMember = jest.fn();
export const mockApplyToWorkspace = jest.fn();
export const mockAcceptInvitation = jest.fn();
export const mockCreateWorkspace = jest.fn();
export const mockUpdateDefaultWorkspace = jest.fn();
export const mockListKnowledgeBases = jest.fn();
export const mockListWorkspaceMembers = jest.fn();
export const mockFindWorkspaceMember = jest.fn();
export const mockGetUser = jest.fn();
export const mockListUsers = jest.fn();
export const mockGetSessionTokenFromRequest = jest.fn();
export const mockListAllWorkspaces = jest.fn();
export const mockFindWorkspace = jest.fn();
export const mockCreateAuditEvent = jest.fn();
export const mockListServiceAccounts = jest.fn();
export const mockListApiTokens = jest.fn();
export const mockListIdentityProviders = jest.fn();
export const mockListAccessReviews = jest.fn();
export const mockListDirectoryGroups = jest.fn();
export const mockListBreakGlassGrants = jest.fn();
export const mockFindResolvedRoleBindings = jest.fn();

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

export const ownerGrantedActions = [
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

export const createReq = (overrides: Partial<any> = {}) =>
  ({
    method: 'GET',
    body: {},
    query: {},
    headers: {},
    ...overrides,
  }) as any;

export const createRes = () => {
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

export const sessionPayload = {
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

export const resetWorkspaceApiTestEnv = () => {
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
};

export const restoreWorkspaceApiTestEnv = () => {
  if (originalBindingMode === undefined) {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
  } else {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
  }
};
