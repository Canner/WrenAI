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
const mockQueryPreview = jest.fn();
const mockAssertAuthorizedWithAudit = jest.fn();
const mockBuildAuthorizationActorFromRuntimeScope = jest.fn();
const mockBuildAuthorizationContextFromRequest = jest.fn();

class MockApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: {},
    auditEventRepository: {},
    queryService: {
      preview: mockQueryPreview,
    },
  },
}));

jest.mock('@/apollo/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWith: mockRespondWith,
  handleApiError: mockHandleApiError,
  deriveRuntimeExecutionContextFromRequest:
    mockDeriveRuntimeExecutionContextFromRequest,
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

describe('pages/api/v1/run_sql', () => {
  const runtimeScope = {
    workspace: { id: 'workspace-1' },
    knowledgeBase: { id: 'kb-1' },
    kbSnapshot: { id: 'snapshot-1' },
    deployment: { hash: 'deploy-1', manifest: { models: [] } },
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
      query: {},
      body: {
        sql: 'select 1',
      },
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

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
    mockQueryPreview.mockResolvedValue({
      columns: [{ name: 'count' }],
      data: [[1]],
    });
  });

  it('requests latest executable snapshot enforcement before running SQL', async () => {
    const handler = (await import('../v1/run_sql')).default;
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
    expect(mockQueryPreview).toHaveBeenCalledWith('select 1', {
      project: executionContext.project,
      limit: 1000,
      manifest: executionContext.manifest,
      modelingOnly: false,
      dryRun: false,
    });
    expect(mockRespondWith).toHaveBeenCalled();
  });

  it('supports dry-run validation through the REST route', async () => {
    const handler = (await import('../v1/run_sql')).default;
    const req = createReq({
      body: {
        sql: 'select 1',
        limit: 1,
        dryRun: true,
      },
    });
    const res = createRes();

    mockQueryPreview.mockResolvedValue(true);

    await handler(req, res);

    expect(mockQueryPreview).toHaveBeenCalledWith('select 1', {
      project: executionContext.project,
      limit: 1,
      manifest: executionContext.manifest,
      modelingOnly: false,
      dryRun: true,
    });
    expect(mockRespondWith).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        responsePayload: { valid: true },
      }),
    );
  });
});

export {};
