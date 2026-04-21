export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockListThreads = jest.fn();
const mockCreateThread = jest.fn();
const mockRespondWithSimple = jest.fn();
const mockCreateAuditEvent = jest.fn();
const mockHandleApiError = jest.fn(
  async ({
    error,
    res,
  }: {
    error: Error & { statusCode?: number };
    res: any;
  }) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
  },
);

class MockApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
    askingService: {
      listThreads: mockListThreads,
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
  },
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWithSimple: mockRespondWithSimple,
  handleApiError: mockHandleApiError,
}));

jest.mock('@server/controllers/askingController', () => ({
  AskingController: jest.fn().mockImplementation(() => ({
    createThread: mockCreateThread,
  })),
}));

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

describe('pages/api/v1/threads route', () => {
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    project: { id: 21 },
    workspace: { id: 'ws-1', kind: 'regular' },
    knowledgeBase: { id: 'kb-1', kind: 'regular' },
    userId: 'user-1',
    actorClaims: {
      workspaceId: 'ws-1',
      workspaceMemberId: 'member-1',
      roleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      grantedActions: ['knowledge_base.read'],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    },
    ...overrides,
  });

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      query: {},
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('lists runtime-scoped threads through the REST endpoint', async () => {
    const handler = (await import('../../pages/api/v1/threads')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockListThreads.mockResolvedValue([
      {
        id: 11,
        summary: '最近一次经营分析',
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
    ]);

    await handler(req, res);

    expect(mockListThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: null,
        deployHash: null,
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'GET_THREADS',
        responsePayload: [
          expect.objectContaining({
            id: 11,
            summary: '最近一次经营分析',
            workspaceId: 'ws-1',
          }),
        ],
      }),
    );
  });

  it('returns 405 for methods outside GET/POST', async () => {
    const handler = (await import('../../pages/api/v1/threads')).default;
    const req = createReq({ method: 'DELETE' });
    const res = createRes();

    await handler(req, res);

    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });
});
