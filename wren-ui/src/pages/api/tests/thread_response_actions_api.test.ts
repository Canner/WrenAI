export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockGenerateThreadResponseAnswerScoped = jest.fn();
const mockGenerateThreadResponseChartScoped = jest.fn();
const mockAdjustThreadResponseChartScoped = jest.fn();
const mockGetAskingTaskById = jest.fn();
const mockGetAdjustmentTaskById = jest.fn();
const mockGetViewByRuntimeIdentity = jest.fn();
const mockGetSqlPair = jest.fn();
const mockGetProjectById = jest.fn();
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
      generateThreadResponseAnswerScoped:
        mockGenerateThreadResponseAnswerScoped,
      generateThreadResponseChartScoped: mockGenerateThreadResponseChartScoped,
      adjustThreadResponseChartScoped: mockAdjustThreadResponseChartScoped,
      getAskingTaskById: mockGetAskingTaskById,
      getAdjustmentTaskById: mockGetAdjustmentTaskById,
    },
    modelService: {
      getViewByRuntimeIdentity: mockGetViewByRuntimeIdentity,
    },
    sqlPairService: {
      getSqlPair: mockGetSqlPair,
    },
    projectService: {
      getProjectById: mockGetProjectById,
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

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

describe('pages/api/v1/thread-responses/[...path] route', () => {
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    project: { id: 21, language: 'ZH_TW' },
    workspace: { id: 'ws-1', kind: 'regular' },
    knowledgeBase: { id: 'kb-1', kind: 'regular' },
    kbSnapshot: { id: 'snap-1' },
    deployHash: 'deploy-1',
    selector: { runtimeScopeId: 'scope-1' },
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
      query: { path: ['101', 'generate-answer'] },
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;
  const responsePayload = {
    id: 101,
    threadId: 11,
    askingTaskId: null,
    viewId: null,
    question: '这个月 GMV 是多少？',
    sql: 'select 1',
    answerDetail: null,
    breakdownDetail: null,
    chartDetail: null,
    adjustment: null,
  };

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockGetProjectById.mockResolvedValue({ id: 21, language: 'ZH_TW' });
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('triggers text answer generation through the REST endpoint', async () => {
    const handler = (await import('../v1/thread-responses/[...path]')).default;
    const req = createReq();
    const res = createRes();

    mockGenerateThreadResponseAnswerScoped.mockResolvedValue(responsePayload);

    await handler(req, res);

    expect(mockGenerateThreadResponseAnswerScoped).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
      expect.objectContaining({ language: expect.any(String) }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'ASK',
        responsePayload: expect.objectContaining({ id: 101 }),
      }),
    );
  });

  it('triggers chart generation through the REST endpoint', async () => {
    const handler = (await import('../v1/thread-responses/[...path]')).default;
    const req = createReq({ query: { path: ['101', 'generate-chart'] } });
    const res = createRes();

    mockGenerateThreadResponseChartScoped.mockResolvedValue({
      ...responsePayload,
      chartDetail: { queryId: 'chart-1', status: 'FETCHING' },
    });

    await handler(req, res);

    expect(mockGenerateThreadResponseChartScoped).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ workspaceId: 'ws-1' }),
      expect.objectContaining({ language: expect.any(String) }),
      'scope-1',
    );
  });

  it('adjusts a chart through the REST endpoint', async () => {
    const handler = (await import('../v1/thread-responses/[...path]')).default;
    const req = createReq({
      query: { path: ['101', 'adjust-chart'] },
      body: { chartType: 'bar' },
    });
    const res = createRes();

    mockAdjustThreadResponseChartScoped.mockResolvedValue({
      ...responsePayload,
      chartDetail: { chartType: 'bar', status: 'FINISHED' },
    });

    await handler(req, res);

    expect(mockAdjustThreadResponseChartScoped).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ workspaceId: 'ws-1' }),
      { chartType: 'bar' },
      expect.objectContaining({ language: expect.any(String) }),
      'scope-1',
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'ASK',
      }),
    );
  });
});
