import { EventEmitter } from 'events';

const mockDeriveRuntimeExecutionContextFromRequest = jest.fn();
const mockRespondWith = jest.fn();
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
const mockIsAskResultFinished = jest.fn();
const mockValidateSummaryResult = jest.fn();
const mockTransformHistoryInput = jest.fn();
const mockGetScopedThreadHistories = jest.fn();
const mockBuildAskDiagnostics = jest.fn();
const mockBuildAskRuntimeContext = jest.fn();
const mockAssertAuthorizedWithAudit = jest.fn();
const mockBuildAuthorizationActorFromRuntimeScope = jest.fn();
const mockBuildAuthorizationContextFromRequest = jest.fn();
const mockPollUntil = jest.fn(async ({ fetcher, onTick }: any) => {
  const result = await fetcher();
  onTick?.(result, 1);
  return result;
});

const mockAsk = jest.fn();
const mockGetAskResult = jest.fn();
const mockCreateTextBasedAnswer = jest.fn();
const mockGetTextBasedAnswerResult = jest.fn();
const mockStreamTextBasedAnswer = jest.fn();
const mockQueryPreview = jest.fn();

class MockApiError extends Error {
  statusCode: number;
  code?: string;
  additionalData?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number,
    code?: string,
    additionalData?: Record<string, any>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.additionalData = additionalData;
  }
}

jest.mock('uuid', () => ({
  v4: () => 'thread-generated',
}));

jest.mock('@/common', () => ({
  components: {
    apiHistoryRepository: {},
    runtimeScopeResolver: {},
    auditEventRepository: {},
    wrenAIAdaptor: {
      ask: mockAsk,
      getAskResult: mockGetAskResult,
      createTextBasedAnswer: mockCreateTextBasedAnswer,
      getTextBasedAnswerResult: mockGetTextBasedAnswerResult,
      streamTextBasedAnswer: mockStreamTextBasedAnswer,
    },
    queryService: {
      preview: mockQueryPreview,
    },
  },
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWith: mockRespondWith,
  handleApiError: mockHandleApiError,
  MAX_WAIT_TIME: 10,
  isAskResultFinished: mockIsAskResultFinished,
  validateSummaryResult: mockValidateSummaryResult,
  transformHistoryInput: mockTransformHistoryInput,
  getScopedThreadHistories: mockGetScopedThreadHistories,
  buildAskDiagnostics: mockBuildAskDiagnostics,
  deriveRuntimeExecutionContextFromRequest:
    mockDeriveRuntimeExecutionContextFromRequest,
  pollUntil: mockPollUntil,
}));

jest.mock('@server/utils/askContext', () => ({
  buildAskRuntimeContext: mockBuildAskRuntimeContext,
}));

jest.mock('@server/authz', () => ({
  assertAuthorizedWithAudit: (...args: any[]) =>
    mockAssertAuthorizedWithAudit(...args),
  buildAuthorizationActorFromRuntimeScope: (...args: any[]) =>
    mockBuildAuthorizationActorFromRuntimeScope(...args),
  buildAuthorizationContextFromRequest: (...args: any[]) =>
    mockBuildAuthorizationContextFromRequest(...args),
}));

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

describe('pages/api/v1/ask', () => {
  const runtimeScope = {
    project: null,
    selector: {
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      runtimeScopeId: 'deploy-1',
    },
    deployment: { projectId: 42, hash: 'deploy-1', manifest: { models: [] } },
    workspace: { id: 'workspace-1' },
    knowledgeBase: { id: 'kb-1' },
    kbSnapshot: { id: 'snapshot-1' },
    deployHash: 'deploy-1',
    userId: 'user-1',
  };

  const executionContext = {
    project: { id: 42, language: 'EN' },
    deployment: runtimeScope.deployment,
    manifest: runtimeScope.deployment.manifest,
    language: 'English',
    runtimeIdentity: {
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    },
  };

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      body: {
        question: '销售额怎么样？',
      },
      headers: {},
      on: jest.fn(),
      ...overrides,
    }) as any;

  const createRes = () =>
    ({
      statusCode: 200,
      body: null,
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDeriveRuntimeExecutionContextFromRequest.mockResolvedValue({
      runtimeScope,
      executionContext,
    });
    mockGetScopedThreadHistories.mockResolvedValue([]);
    mockTransformHistoryInput.mockReturnValue([]);
    mockBuildAskRuntimeContext.mockResolvedValue({
      runtimeIdentity: executionContext.runtimeIdentity,
      skills: [],
    });
    mockBuildAuthorizationActorFromRuntimeScope.mockReturnValue({
      principalType: 'user',
      principalId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceRoleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      isPlatformAdmin: false,
      platformRoleKeys: [],
    });
    mockBuildAuthorizationContextFromRequest.mockReturnValue({
      requestId: 'req-1',
    });
    mockAssertAuthorizedWithAudit.mockResolvedValue({ allowed: true });
    mockAsk.mockResolvedValue({ queryId: 'ask-query-1' });
    mockGetAskResult.mockResolvedValue({
      status: 'finished',
      type: 'TEXT_TO_SQL',
      response: [{ sql: 'select * from sales' }],
      error: null,
    });
    mockIsAskResultFinished.mockReturnValue(true);
    mockQueryPreview.mockResolvedValue({
      columns: [{ name: 'amount' }],
      data: [[123]],
    });
    mockCreateTextBasedAnswer.mockResolvedValue({ queryId: 'summary-query-1' });
    mockGetTextBasedAnswerResult.mockResolvedValue({ status: 'SUCCEEDED' });
    mockBuildAskDiagnostics.mockReturnValue({ resolvedRuntime: 'deepagents' });
    mockValidateSummaryResult.mockImplementation(() => undefined);

    mockStreamTextBasedAnswer.mockImplementation(async () => {
      const emitter = new EventEmitter();
      process.nextTick(() => {
        emitter.emit('data', Buffer.from('data: {"message":"总结完成"}'));
        emitter.emit('end');
      });
      return emitter;
    });
  });

  it('uses derived runtime project for multi-source ask execution', async () => {
    const handler = (await import('../v1/ask')).default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(mockDeriveRuntimeExecutionContextFromRequest).toHaveBeenCalledWith({
      req,
      runtimeScopeResolver: expect.any(Object),
      requireLatestExecutableSnapshot: true,
    });
    expect(mockAssertAuthorizedWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resource: expect.objectContaining({
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          workspaceId: 'workspace-1',
        }),
      }),
    );
    expect(mockBuildAskRuntimeContext).toHaveBeenCalledWith({
      runtimeIdentity: executionContext.runtimeIdentity,
    });
    expect(mockAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '销售额怎么样？',
        deployId: 'deploy-1',
        runtimeIdentity: executionContext.runtimeIdentity,
        skills: [],
      }),
    );
    expect(mockQueryPreview).toHaveBeenCalledWith('select * from sales', {
      project: executionContext.project,
      limit: 500,
      manifest: executionContext.manifest,
      modelingOnly: false,
    });
    expect(mockRespondWith).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeScope,
        responsePayload: expect.objectContaining({
          sql: 'select * from sales',
          summary: '总结完成',
          threadId: 'thread-generated',
        }),
      }),
    );
  });

  it('returns authorization failure when knowledge base read is denied', async () => {
    const handler = (await import('../v1/ask')).default;
    const req = createReq();
    const res = createRes();

    mockAssertAuthorizedWithAudit.mockRejectedValueOnce(
      new MockApiError('Knowledge base read permission required', 403),
    );

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'Knowledge base read permission required',
    });
    expect(mockAsk).not.toHaveBeenCalled();
  });
});

export {};
