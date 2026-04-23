export {};

const mockBuildApiContextFromRequest = jest.fn();
const mockSendRestApiError = jest.fn(
  (res: any, error: Error & { statusCode?: number }) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
    return res;
  },
);
const mockToCanonicalPersistedRuntimeIdentityFromScope = jest.fn();
const mockToAskRuntimeIdentity = jest.fn();
const mockResolveProjectLanguage = jest.fn();
const mockAssertExecutableRuntimeScope = jest.fn();
const mockAssertKnowledgeBaseReadAccess = jest.fn();

class MockApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

jest.mock('@/server/api/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

jest.mock('@/server/api/restApi', () => ({
  sendRestApiError: mockSendRestApiError,
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
}));

jest.mock('@server/utils/persistedRuntimeIdentity', () => ({
  toCanonicalPersistedRuntimeIdentityFromScope:
    mockToCanonicalPersistedRuntimeIdentityFromScope,
}));

jest.mock('@server/controllers/projectControllerRuntimeSupport', () => ({
  toAskRuntimeIdentity: mockToAskRuntimeIdentity,
}));

jest.mock('@server/utils/runtimeExecutionContext', () => ({
  resolveProjectLanguage: mockResolveProjectLanguage,
}));

jest.mock('@server/controllers/modelControllerScopeSupport', () => ({
  assertExecutableRuntimeScope: mockAssertExecutableRuntimeScope,
  assertKnowledgeBaseReadAccess: mockAssertKnowledgeBaseReadAccess,
}));

describe('pages/api/v1/semantics-descriptions routes', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      query: { id: 'task-1' },
      body: {
        selectedModels: ['employees'],
        userPrompt: 'Describe this model',
      },
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => {
    const res = { statusCode: 200, body: null } as any;
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload: any) => {
      res.body = payload;
      return res;
    };
    res.setHeader = jest.fn();
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertExecutableRuntimeScope.mockResolvedValue(undefined);
    mockAssertKnowledgeBaseReadAccess.mockResolvedValue(undefined);
    mockToCanonicalPersistedRuntimeIdentityFromScope.mockReturnValue({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    });
    mockToAskRuntimeIdentity.mockReturnValue({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    });
    mockResolveProjectLanguage.mockReturnValue('Simplified Chinese');
  });

  it('starts semantics description generation on POST', async () => {
    const handler = (await import('../../pages/api/v1/semantics-descriptions'))
      .default;
    const req = createReq();
    const res = createRes();

    mockBuildApiContextFromRequest.mockResolvedValue({
      runtimeScope: {
        selector: { runtimeScopeId: 'scope-1' },
        knowledgeBase: { id: 'kb-1' },
      },
      mdlService: {
        makeCurrentModelMDLByRuntimeIdentity: jest.fn().mockResolvedValue({
          manifest: { models: [] },
          project: { language: 'ZH_CN' },
        }),
      },
      wrenAIAdaptor: {
        generateSemanticsDescription: jest.fn().mockResolvedValue({
          queryId: 'task-1',
        }),
      },
    });

    await handler(req, res);

    const ctx = await mockBuildApiContextFromRequest.mock.results[0].value;
    expect(ctx.wrenAIAdaptor.generateSemanticsDescription).toHaveBeenCalledWith(
      {
        manifest: { models: [] },
        selectedModels: ['employees'],
        userPrompt: 'Describe this model',
        runtimeScopeId: 'scope-1',
        runtimeIdentity: { workspaceId: 'ws-1', knowledgeBaseId: 'kb-1' },
        configurations: { language: 'Simplified Chinese' },
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 'task-1' });
  });

  it('returns the task payload on GET', async () => {
    const handler = (
      await import('../../pages/api/v1/semantics-descriptions/[id]')
    ).default;
    const req = createReq({ method: 'GET', query: { id: 'task-1' } });
    const res = createRes();

    mockBuildApiContextFromRequest.mockResolvedValue({
      wrenAIAdaptor: {
        getSemanticsDescriptionResult: jest.fn().mockResolvedValue({
          status: 'FINISHED',
          response: [],
          error: null,
          traceId: 'trace-1',
        }),
      },
    });

    await handler(req, res);

    const ctx = await mockBuildApiContextFromRequest.mock.results[0].value;
    expect(
      ctx.wrenAIAdaptor.getSemanticsDescriptionResult,
    ).toHaveBeenCalledWith('task-1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: 'task-1',
      status: 'FINISHED',
      response: [],
      error: null,
      traceId: 'trace-1',
    });
  });

  it('returns 400 when selected models are missing on POST', async () => {
    const handler = (await import('../../pages/api/v1/semantics-descriptions'))
      .default;
    const req = createReq({ body: { selectedModels: [] } });
    const res = createRes();

    mockBuildApiContextFromRequest.mockResolvedValue({
      runtimeScope: {
        selector: { runtimeScopeId: 'scope-1' },
        knowledgeBase: { id: 'kb-1' },
      },
      mdlService: {
        makeCurrentModelMDLByRuntimeIdentity: jest.fn().mockResolvedValue({
          manifest: { models: [] },
          project: { language: 'ZH_CN' },
        }),
      },
      wrenAIAdaptor: {
        generateSemanticsDescription: jest.fn(),
      },
    });

    await handler(req, res);

    expect(mockSendRestApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'selectedModels is required' });
  });
});
