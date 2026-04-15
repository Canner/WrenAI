export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockGetResponseScoped = jest.fn();
const mockUpdateThreadResponseScoped = jest.fn();
const mockGetAskingTaskById = jest.fn();
const mockGetAdjustmentTaskById = jest.fn();
const mockGetViewByRuntimeIdentity = jest.fn();
const mockGetSqlPair = jest.fn();
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
      getResponseScoped: mockGetResponseScoped,
      updateThreadResponseScoped: mockUpdateThreadResponseScoped,
      getAskingTaskById: mockGetAskingTaskById,
      getAdjustmentTaskById: mockGetAdjustmentTaskById,
    },
    modelService: {
      getViewByRuntimeIdentity: mockGetViewByRuntimeIdentity,
    },
    sqlPairService: {
      getSqlPair: mockGetSqlPair,
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

describe('pages/api/v1/thread-responses/[id] route', () => {
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
      method: 'GET',
      query: { id: '101' },
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockGetViewByRuntimeIdentity.mockResolvedValue({
      id: 7,
      name: 'sales_view',
      statement: 'select * from sales',
      properties: JSON.stringify({ displayName: '销售视图' }),
    });
    mockGetSqlPair.mockResolvedValue({
      id: 9,
      question: '历史 GMV',
      sql: 'select amount from sales',
    });
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('returns the scoped thread response through the REST endpoint', async () => {
    const handler = (await import('../v1/thread-responses/[id]')).default;
    const req = createReq();
    const res = createRes();

    mockGetResponseScoped.mockResolvedValue({
      id: 101,
      threadId: 11,
      askingTaskId: 88,
      viewId: 7,
      question: '这个月 GMV 是多少？',
      sql: 'select sum(amount) from sales',
      answerDetail: {
        status: 'FINISHED',
        content: 'GMV is 100\nDone',
      },
      breakdownDetail: null,
      chartDetail: null,
      adjustment: null,
    });
    mockGetAskingTaskById.mockResolvedValue({
      status: 'SEARCHING',
      type: 'TEXT_TO_SQL',
      queryId: 'ask-1',
      response: [
        {
          type: 'VIEW',
          sql: 'select * from sales',
          viewId: 7,
          sqlpairId: 9,
        },
      ],
      error: null,
      question: '这个月 GMV 是多少？',
      taskId: 88,
    });
    mockGetAdjustmentTaskById.mockResolvedValue(null);

    await handler(req, res);

    expect(mockGetResponseScoped).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        projectId: null,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        responsePayload: expect.objectContaining({
          id: 101,
          threadId: 11,
          question: '这个月 GMV 是多少？',
          view: expect.objectContaining({
            id: 7,
            displayName: '销售视图',
          }),
          askingTask: expect.objectContaining({
            queryId: 'ask-1',
          }),
          answerDetail: expect.objectContaining({
            content: 'GMV is 100\nDone',
          }),
        }),
      }),
    );
  });

  it('updates the scoped thread response sql through the REST endpoint', async () => {
    const handler = (await import('../v1/thread-responses/[id]')).default;
    const req = createReq({
      method: 'PATCH',
      body: { sql: 'select total from sales' },
    });
    const res = createRes();

    mockUpdateThreadResponseScoped.mockResolvedValue({
      id: 101,
      threadId: 11,
      askingTaskId: null,
      viewId: null,
      question: '这个月 GMV 是多少？',
      sql: 'select total from sales',
      answerDetail: null,
      breakdownDetail: null,
      chartDetail: null,
      adjustment: null,
    });

    await handler(req, res);

    expect(mockUpdateThreadResponseScoped).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        projectId: null,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
      { sql: 'select total from sales' },
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'UPDATE_THREAD',
        responsePayload: expect.objectContaining({
          id: 101,
          question: '这个月 GMV 是多少？',
        }),
      }),
    );
  });

  it('returns 400 when the response id is invalid', async () => {
    const handler = (await import('../v1/thread-responses/[id]')).default;
    const req = createReq({ query: { id: '0' } });
    const res = createRes();

    await handler(req, res);

    expect(mockGetResponseScoped).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Response ID is invalid' });
  });
});
