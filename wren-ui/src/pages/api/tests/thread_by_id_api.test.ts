export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockAssertThreadScope = jest.fn();
const mockGetResponsesWithThreadScoped = jest.fn();
const mockUpdateThreadScoped = jest.fn();
const mockDeleteThreadScoped = jest.fn();
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
      getResponsesWithThreadScoped: mockGetResponsesWithThreadScoped,
      updateThreadScoped: mockUpdateThreadScoped,
      deleteThreadScoped: mockDeleteThreadScoped,
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

describe('pages/api/v1/threads/[id] route', () => {
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
      method: 'PATCH',
      query: { id: '11' },
      body: {},
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

  it('updates the scoped thread summary through the REST endpoint', async () => {
    const handler = (await import('../v1/threads/[id]')).default;
    const req = createReq({
      method: 'PATCH',
      body: { summary: '新的问题总结' },
    });
    const res = createRes();

    mockUpdateThreadScoped.mockResolvedValue({
      id: 11,
      summary: '新的问题总结',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: null,
      deployHash: null,
    });

    await handler(req, res);

    expect(mockUpdateThreadScoped).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        projectId: null,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
      { summary: '新的问题总结' },
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'UPDATE_THREAD',
        responsePayload: expect.objectContaining({
          id: 11,
          summary: '新的问题总结',
        }),
      }),
    );
  });

  it('returns the scoped thread detail through the REST endpoint', async () => {
    const handler = (await import('../v1/threads/[id]')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockAssertThreadScope.mockResolvedValue({
      id: 11,
      summary: '新的问题总结',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      knowledgeBaseIds: ['kb-1'],
      selectedSkillIds: ['skill-1'],
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
    mockGetResponsesWithThreadScoped.mockResolvedValue([
      {
        id: 101,
        threadId: 11,
        question: '这个月 GMV 是多少？',
        sql: 'select 1',
        answerDetail: { status: 'FINISHED', content: '100' },
      },
    ]);

    await handler(req, res);

    expect(mockAssertThreadScope).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        projectId: null,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    );
    expect(mockGetResponsesWithThreadScoped).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        projectId: null,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'GET_THREADS',
        responsePayload: expect.objectContaining({
          id: 11,
          knowledgeBaseIds: ['kb-1'],
          selectedSkillIds: ['skill-1'],
          responses: [
            expect.objectContaining({
              id: 101,
              question: '这个月 GMV 是多少？',
              view: null,
              askingTask: null,
              adjustmentTask: null,
            }),
          ],
        }),
      }),
    );
  });

  it('deletes the scoped thread through the REST endpoint', async () => {
    const handler = (await import('../v1/threads/[id]')).default;
    const req = createReq({ method: 'DELETE' });
    const res = createRes();

    await handler(req, res);

    expect(mockDeleteThreadScoped).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        projectId: null,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'DELETE_THREAD',
        responsePayload: { success: true },
      }),
    );
  });

  it('returns 400 when the thread id is invalid', async () => {
    const handler = (await import('../v1/threads/[id]')).default;
    const req = createReq({ query: { id: '0' } });
    const res = createRes();

    await handler(req, res);

    expect(mockUpdateThreadScoped).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Thread ID is invalid' });
  });

  it('returns 400 when the thread summary is empty', async () => {
    const handler = (await import('../v1/threads/[id]')).default;
    const req = createReq({
      body: { summary: '   ' },
    });
    const res = createRes();

    await handler(req, res);

    expect(mockUpdateThreadScoped).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Thread summary is required' });
  });

  it('returns 405 for unsupported methods', async () => {
    const handler = (await import('../v1/threads/[id]')).default;
    const req = createReq({ method: 'POST' });
    const res = createRes();

    await handler(req, res);

    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });
});
