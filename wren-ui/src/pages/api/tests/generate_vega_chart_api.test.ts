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
const mockPollUntil = jest.fn(async ({ fetcher }: any) => fetcher());
const mockQueryPreview = jest.fn();
const mockGenerateChart = jest.fn();
const mockGetChartResult = jest.fn();
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

jest.mock('uuid', () => ({
  v4: () => 'thread-generated',
}));

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: {},
    wrenAIAdaptor: {
      generateChart: mockGenerateChart,
      getChartResult: mockGetChartResult,
    },
    queryService: {
      preview: mockQueryPreview,
    },
    auditEventRepository: {},
  },
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWith: mockRespondWith,
  handleApiError: mockHandleApiError,
  deriveRuntimeExecutionContextFromRequest:
    mockDeriveRuntimeExecutionContextFromRequest,
  pollUntil: mockPollUntil,
}));

jest.mock('@server/authz', () => ({
  assertAuthorizedWithAudit: (...args: any[]) =>
    mockAssertAuthorizedWithAudit(...args),
  buildAuthorizationActorFromRuntimeScope: (...args: any[]) =>
    mockBuildAuthorizationActorFromRuntimeScope(...args),
  buildAuthorizationContextFromRequest: (...args: any[]) =>
    mockBuildAuthorizationContextFromRequest(...args),
}));

describe('pages/api/v1/generate_vega_chart', () => {
  const runtimeScope = {
    selector: {
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      runtimeScopeId: 'deploy-1',
    },
    workspace: { id: 'workspace-1', kind: 'regular' },
    knowledgeBase: { id: 'kb-1', kind: 'default' },
    kbSnapshot: { id: 'snapshot-1' },
    deployment: { projectId: 42, hash: 'deploy-1', manifest: { models: [] } },
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
        question: '按品类看销售额',
        sql: 'select category, sales from metrics',
      },
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () =>
    ({
      statusCode: 200,
      body: null,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
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
    mockQueryPreview.mockResolvedValue({
      columns: [
        { name: 'category', type: 'string' },
        { name: 'sales', type: 'number' },
      ],
      data: Array.from({ length: 30 }, (_, index) => [
        `c-${index}`,
        100 - index,
      ]),
    });
    mockGenerateChart.mockResolvedValue({ queryId: 'chart-query-1' });
    mockGetChartResult.mockResolvedValue({
      status: 'finished',
      response: {
        chartSchema: {
          mark: 'bar',
          encoding: {
            x: { field: 'category', type: 'nominal', title: 'Category' },
            y: { field: 'sales', type: 'quantitative', title: 'Sales' },
          },
        },
      },
      error: null,
    });
  });

  it('authorizes KB read and returns canonicalized shaped chart metadata', async () => {
    const handler = (await import('../v1/generate_vega_chart')).default;
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
        runtimeScope,
        responsePayload: expect.objectContaining({
          threadId: 'thread-generated',
          canonicalizationVersion: 'chart-canonical-v1',
          validationErrors: [],
          renderHints: expect.objectContaining({
            suggestedTopN: 25,
            isLargeCategory: true,
          }),
          chartDataProfile: expect.objectContaining({
            sourceRowCount: 30,
            resultRowCount: 26,
            appliedShaping: expect.arrayContaining([
              expect.objectContaining({ type: 'top_n', value: 25 }),
              expect.objectContaining({ type: 'other_bucket' }),
            ]),
          }),
          vegaSpec: expect.objectContaining({
            data: expect.objectContaining({
              values: expect.any(Array),
            }),
          }),
        }),
      }),
    );

    const responsePayload = mockRespondWith.mock.calls[0][0].responsePayload;
    expect(responsePayload.vegaSpec.data.values).toHaveLength(26);
    expect(res.headers.Deprecation).toBe('true');
    expect(res.headers.Warning).toContain('/api/v1/generate_vega_chart');
  });
});

export {};
