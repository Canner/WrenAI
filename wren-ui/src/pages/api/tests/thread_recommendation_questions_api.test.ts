export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockAssertThreadScope = jest.fn();
const mockGetThreadRecommendationQuestions = jest.fn();
const mockGenerateThreadRecommendationQuestions = jest.fn();
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
      assertThreadScope: mockAssertThreadScope,
      getThreadRecommendationQuestions: mockGetThreadRecommendationQuestions,
      generateThreadRecommendationQuestions:
        mockGenerateThreadRecommendationQuestions,
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

describe('pages/api/v1/thread-recommendation-questions/[id] route', () => {
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    project: { id: 21 },
    workspace: { id: 'ws-1', kind: 'regular' },
    knowledgeBase: { id: 'kb-1', kind: 'regular' },
    kbSnapshot: { id: 'snap-1' },
    deployHash: 'deploy-1',
    userId: 'user-1',
    selector: { runtimeScopeId: 'scope-1' },
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
      query: { id: '11' },
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

  it('returns the scoped thread recommendation questions through the REST endpoint', async () => {
    const handler = (await import('../v1/thread-recommendation-questions/[id]'))
      .default;
    const req = createReq();
    const res = createRes();

    mockGetThreadRecommendationQuestions.mockResolvedValue({
      status: 'FINISHED',
      questions: [
        {
          question: '按地区查看 GMV 趋势',
          category: '分析',
          sql: 'select 1',
        },
      ],
      error: null,
    });

    await handler(req, res);

    expect(mockAssertThreadScope).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        projectId: 21,
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
          status: 'FINISHED',
          questions: [
            expect.objectContaining({
              question: '按地区查看 GMV 趋势',
            }),
          ],
        }),
      }),
    );
  });

  it('starts recommendation generation through the REST endpoint', async () => {
    const handler = (await import('../v1/thread-recommendation-questions/[id]'))
      .default;
    const req = createReq({ method: 'POST' });
    const res = createRes();

    await handler(req, res);

    expect(mockAssertThreadScope).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    );
    expect(mockGenerateThreadRecommendationQuestions).toHaveBeenCalledWith(
      11,
      'scope-1',
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'ASK',
        responsePayload: { success: true },
      }),
    );
  });

  it('returns 400 when the thread id is invalid', async () => {
    const handler = (await import('../v1/thread-recommendation-questions/[id]'))
      .default;
    const req = createReq({ query: { id: '0' } });
    const res = createRes();

    await handler(req, res);

    expect(mockAssertThreadScope).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Thread ID is invalid' });
  });
});
