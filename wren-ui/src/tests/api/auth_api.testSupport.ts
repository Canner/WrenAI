export const mockBootstrapOwner = jest.fn();
export const mockLogin = jest.fn();
export const mockLogout = jest.fn();
export const mockValidateSession = jest.fn();
export const mockRegisterLocalUser = jest.fn();
export const mockChangeLocalPassword = jest.fn();
export const mockListWorkspacesForUser = jest.fn();
export const mockListKnowledgeBases = jest.fn();
export const mockListKbSnapshots = jest.fn();
export const mockGetKbSnapshot = jest.fn();
export const mockFindAuthIdentity = jest.fn();
export const mockEnforceRateLimit = jest.fn();
export const mockStartWorkspaceSSO = jest.fn();
export const mockCompleteWorkspaceSSO = jest.fn();
export const mockFindSsoSession = jest.fn();
export const mockStartImpersonation = jest.fn();
export const mockStopImpersonation = jest.fn();
export const mockCreateAuditEvent = jest.fn();

jest.mock('@/common', () => ({
  components: {
    authService: {
      bootstrapOwner: mockBootstrapOwner,
      login: mockLogin,
      logout: mockLogout,
      validateSession: mockValidateSession,
      registerLocalUser: mockRegisterLocalUser,
      changeLocalPassword: mockChangeLocalPassword,
    },
    workspaceService: {
      listWorkspacesForUser: mockListWorkspacesForUser,
    },
    knowledgeBaseRepository: {
      findAllBy: mockListKnowledgeBases,
    },
    kbSnapshotRepository: {
      findAllBy: mockListKbSnapshots,
      findOneBy: mockGetKbSnapshot,
    },
    authIdentityRepository: {
      findOneBy: mockFindAuthIdentity,
    },
    identityProviderService: {
      startWorkspaceSSO: mockStartWorkspaceSSO,
      completeWorkspaceSSO: mockCompleteWorkspaceSSO,
    },
    ssoSessionRepository: {
      findOneBy: mockFindSsoSession,
    },
    governanceService: {
      startImpersonation: mockStartImpersonation,
      stopImpersonation: mockStopImpersonation,
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
  },
}));

jest.mock('@server/utils/rateLimit', () => ({
  enforceRateLimit: (...args: any[]) => mockEnforceRateLimit(...args),
}));

export const createReq = (overrides: Partial<any> = {}) =>
  ({
    method: 'GET',
    body: {},
    query: {},
    headers: {},
    ...overrides,
  }) as any;

export const createRes = () => {
  const headers: Record<string, any> = {};
  const res: any = {
    statusCode: 200,
    body: undefined,
    setHeader: jest.fn((key: string, value: any) => {
      headers[key] = value;
    }),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((payload: any) => {
      res.body = payload;
      return res;
    }),
    writeHead: jest.fn((code: number, payload: any) => {
      res.statusCode = code;
      res.headers = payload;
      return res;
    }),
    end: jest.fn(),
    getHeader: (key: string) => headers[key],
  };
  return res;
};

export const resetAuthApiMocks = () => {
  jest.clearAllMocks();
  mockEnforceRateLimit.mockResolvedValue({ limited: false });
  mockListKnowledgeBases.mockResolvedValue([]);
  mockListKbSnapshots.mockResolvedValue([]);
  mockGetKbSnapshot.mockResolvedValue(null);
  mockFindAuthIdentity.mockResolvedValue({ id: 'identity-1' });
  mockFindSsoSession.mockResolvedValue(null);
};
