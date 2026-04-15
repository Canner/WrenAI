export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockCreateThreadResponseScoped = jest.fn();
const mockAssertAskingTaskScope = jest.fn();
const mockGetAskingTask = jest.fn();
const mockGetAskingTaskById = jest.fn();
const mockGetAdjustmentTaskById = jest.fn();
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
      createThreadResponseScoped: mockCreateThreadResponseScoped,
      assertAskingTaskScope: mockAssertAskingTaskScope,
      getAskingTask: mockGetAskingTask,
      getAskingTaskById: mockGetAskingTaskById,
      getAdjustmentTaskById: mockGetAdjustmentTaskById,
    },
    modelService: {
      getViewByRuntimeIdentity: jest.fn(),
    },
    sqlPairService: {
      getSqlPair: jest.fn(),
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
  },
}));

jest.mock('@/apollo/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWithSimple: mockRespondWithSimple,
  handleApiError: mockHandleApiError,
}));

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

describe('pages/api/v1/threads/[...path] route', () => {
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    project: { id: 21 },
    workspace: { id: 'ws-1', kind: 'regular' },
    knowledgeBase: { id: 'kb-1', kind: 'regular' },
    kbSnapshot: { id: 'snap-1' },
    deployHash: 'deploy-1',
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
      method: 'POST',
      query: { path: ['11', 'responses'] },
      body: { taskId: 'ask-1' },
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('creates a scoped thread response from an asking task through the REST endpoint', async () => {
    const handler = (await import('../v1/threads/[...path]')).default;
    const req = createReq();
    const res = createRes();

    mockGetAskingTask.mockResolvedValue({
      queryId: 'ask-1',
      question: '按地区查看 GMV 趋势',
      taskId: 88,
      response: [],
    });
    mockCreateThreadResponseScoped.mockResolvedValue({
      id: 101,
      threadId: 11,
      askingTaskId: null,
      viewId: null,
      question: '按地区查看 GMV 趋势',
      sql: 'select 1',
      answerDetail: null,
      breakdownDetail: null,
      chartDetail: null,
      adjustment: null,
    });

    await handler(req, res);

    expect(mockAssertAskingTaskScope).toHaveBeenCalledWith(
      'ask-1',
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    );
    expect(mockCreateThreadResponseScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        question: '按地区查看 GMV 趋势',
        trackedAskingResult: expect.objectContaining({ queryId: 'ask-1' }),
      }),
      11,
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'ASK',
        responsePayload: expect.objectContaining({
          id: 101,
          threadId: 11,
          question: '按地区查看 GMV 趋势',
        }),
      }),
    );
  });
});
