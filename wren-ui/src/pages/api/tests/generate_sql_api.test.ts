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
const mockValidateAskResult = jest.fn();
const mockTransformHistoryInput = jest.fn();
const mockGetScopedThreadHistories = jest.fn();
const mockBuildAskRuntimeContext = jest.fn();
const mockPollUntil = jest.fn(async ({ fetcher }: any) => fetcher());
const mockAssertAuthorizedWithAudit = jest.fn();
const mockBuildAuthorizationActorFromRuntimeScope = jest.fn();
const mockBuildAuthorizationContextFromRequest = jest.fn();

const mockAsk = jest.fn();
const mockGetAskResult = jest.fn();

class MockApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

jest.mock('uuid', () => ({
  v4: () => 'thread-generated',
}));

jest.mock('@/common', () => ({
  components: {
    apiHistoryRepository: {},
    runtimeScopeResolver: {},
    wrenAIAdaptor: {
      ask: mockAsk,
      getAskResult: mockGetAskResult,
    },
    wrenEngineAdaptor: {
      getNativeSQL: jest.fn(),
    },
    ibisAdaptor: {
      getNativeSql: jest.fn(),
    },
    skillService: {},
    auditEventRepository: {},
  },
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWith: mockRespondWith,
  handleApiError: mockHandleApiError,
  isAskResultFinished: mockIsAskResultFinished,
  validateAskResult: mockValidateAskResult,
  transformHistoryInput: mockTransformHistoryInput,
  deriveRuntimeExecutionContextFromRequest:
    mockDeriveRuntimeExecutionContextFromRequest,
  getScopedThreadHistories: mockGetScopedThreadHistories,
  pollUntil: mockPollUntil,
}));

jest.mock('@server/utils/askContext', () => ({
  buildAskRuntimeContext: mockBuildAskRuntimeContext,
  toAskRuntimeIdentity: (runtimeIdentity: any) => runtimeIdentity,
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

describe('pages/api/v1/generate_sql', () => {
  const runtimeScope = {
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
    project: { id: 42, language: 'EN', type: 'POSTGRES' },
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
    mockGetScopedThreadHistories.mockResolvedValue([]);
    mockTransformHistoryInput.mockReturnValue([]);
    mockBuildAskRuntimeContext.mockResolvedValue({
      runtimeIdentity: executionContext.runtimeIdentity,
      skills: [],
    });
    mockAsk.mockResolvedValue({ queryId: 'ask-query-1' });
    mockGetAskResult.mockResolvedValue({
      status: 'finished',
      type: 'TEXT_TO_SQL',
      response: [{ sql: 'select * from sales' }],
      error: null,
    });
    mockIsAskResultFinished.mockReturnValue(true);
    mockValidateAskResult.mockImplementation(() => undefined);
  });

  it('authorizes knowledge base read before generating sql', async () => {
    const handler = (await import('../v1/generate_sql')).default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

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
    expect(mockRespondWith).toHaveBeenCalledWith(
      expect.objectContaining({
        responsePayload: {
          sql: 'select * from sales',
          threadId: 'thread-generated',
        },
        runtimeScope,
      }),
    );
  });
});

export {};
