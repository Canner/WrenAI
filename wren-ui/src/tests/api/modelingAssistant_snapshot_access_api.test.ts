export {};

const mockBuildApiContextFromRequest = jest.fn();
const mockSendRestApiError = jest.fn(
  (res: any, error: Error & { statusCode?: number }) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
    return res;
  },
);
const mockAssertExecutableRuntimeScope = jest.fn();
const mockAssertKnowledgeBaseReadAccess = jest.fn();
const mockToCanonicalPersistedRuntimeIdentityFromScope = jest.fn();
const mockToAskRuntimeIdentity = jest.fn();
const mockResolveProjectLanguage = jest.fn();

jest.mock('@/server/api/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

jest.mock('@/server/api/restApi', () => ({
  sendRestApiError: mockSendRestApiError,
}));

jest.mock('@server/controllers/modelControllerScopeSupport', () => ({
  assertExecutableRuntimeScope: mockAssertExecutableRuntimeScope,
  assertKnowledgeBaseReadAccess: mockAssertKnowledgeBaseReadAccess,
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

describe('modeling assistant snapshot/access guards', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      query: { id: 'task-1' },
      body: { selectedModels: ['orders'], userPrompt: '' },
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
        generateRelationshipRecommendation: jest.fn().mockResolvedValue({
          queryId: 'rel-task-1',
        }),
        getRelationshipRecommendationResult: jest.fn().mockResolvedValue({
          status: 'FINISHED',
          response: { relationships: [] },
          error: null,
          traceId: null,
        }),
        generateSemanticsDescription: jest.fn().mockResolvedValue({
          queryId: 'sem-task-1',
        }),
        getSemanticsDescriptionResult: jest.fn().mockResolvedValue({
          status: 'FINISHED',
          response: [],
          error: null,
          traceId: null,
        }),
      },
    });
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

  it('guards relationship recommendation creation and reads', async () => {
    const createHandler = (
      await import('../../pages/api/v1/relationship-recommendations')
    ).default;
    const getHandler = (
      await import('../../pages/api/v1/relationship-recommendations/[id]')
    ).default;

    await createHandler(createReq(), createRes());
    await getHandler(createReq({ method: 'GET' }), createRes());

    expect(mockAssertExecutableRuntimeScope).toHaveBeenCalledTimes(2);
    expect(mockAssertKnowledgeBaseReadAccess).toHaveBeenCalledTimes(2);
  });

  it('guards semantics description creation and reads', async () => {
    const createHandler = (
      await import('../../pages/api/v1/semantics-descriptions')
    ).default;
    const getHandler = (
      await import('../../pages/api/v1/semantics-descriptions/[id]')
    ).default;

    await createHandler(createReq(), createRes());
    await getHandler(createReq({ method: 'GET' }), createRes());

    expect(mockAssertExecutableRuntimeScope).toHaveBeenCalledTimes(2);
    expect(mockAssertKnowledgeBaseReadAccess).toHaveBeenCalledTimes(2);
  });
});
