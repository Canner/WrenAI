export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockListModelsByRuntimeIdentity = jest.fn();
const mockGetModelByRuntimeIdentity = jest.fn();
const mockFindColumnsByModelIds = jest.fn();
const mockFindNestedColumnsByModelIds = jest.fn();
const mockPreview = jest.fn();
const mockRespondWithSimple = jest.fn();
const mockCreateAuditEvent = jest.fn();
const mockAssertAuthorizedWithAudit = jest.fn();
const mockBuildAuthorizationActorFromRuntimeScope = jest.fn();
const mockBuildAuthorizationContextFromRequest = jest.fn();
const mockRecordAuditEvent = jest.fn();
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
    modelService: {
      listModelsByRuntimeIdentity: mockListModelsByRuntimeIdentity,
      getModelByRuntimeIdentity: mockGetModelByRuntimeIdentity,
    },
    modelColumnRepository: {
      findColumnsByModelIds: mockFindColumnsByModelIds,
    },
    modelNestedColumnRepository: {
      findNestedColumnsByModelIds: mockFindNestedColumnsByModelIds,
    },
    queryService: {
      preview: mockPreview,
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
  },
}));

jest.mock('@/server/utils/apiUtils', () => {
  const actual = jest.requireActual('@/server/utils/apiUtils');
  return {
    ...actual,
    ApiError: MockApiError,
    respondWithSimple: mockRespondWithSimple,
    handleApiError: mockHandleApiError,
  };
});

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

jest.mock('@server/authz', () => ({
  assertAuthorizedWithAudit: mockAssertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope:
    mockBuildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest:
    mockBuildAuthorizationContextFromRequest,
  recordAuditEvent: mockRecordAuditEvent,
}));

describe('pages/api/v1/models route', () => {
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    source: 'explicit-request',
    selector: { runtimeScopeId: 'scope-1' },
    project: { id: 21, language: 'ZH_TW' },
    deployment: {
      projectId: 21,
      hash: 'deploy-1',
      manifest: { schema: [] },
    },
    deployHash: 'deploy-1',
    workspace: { id: 'ws-1', kind: 'regular' },
    knowledgeBase: {
      id: 'kb-1',
      kind: 'regular',
      defaultKbSnapshotId: 'snap-1',
    },
    kbSnapshot: { id: 'snap-1', deployHash: 'deploy-1' },
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
      query: { id: '7', limit: '25' },
      body: {},
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
    return res;
  };

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockAssertAuthorizedWithAudit.mockResolvedValue(undefined);
    mockBuildAuthorizationActorFromRuntimeScope.mockImplementation(
      (runtimeScope: any) => ({
        userId: runtimeScope?.userId || 'user-1',
        sessionId: 'session-1',
      }),
    );
    mockBuildAuthorizationContextFromRequest.mockImplementation(
      ({ runtimeScope }: any) => ({
        workspaceId: runtimeScope?.workspace?.id || null,
      }),
    );
    mockListModelsByRuntimeIdentity.mockResolvedValue([
      {
        id: 7,
        displayName: '订单',
        referenceName: 'orders',
        sourceTableName: 'sales.orders',
        cached: false,
        refreshTime: null,
        properties: JSON.stringify({ description: '订单表' }),
      },
    ]);
    mockGetModelByRuntimeIdentity.mockResolvedValue({
      id: 7,
      referenceName: 'orders',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
    mockFindColumnsByModelIds.mockResolvedValue([
      { id: 1, modelId: 7, referenceName: 'order_id' },
      { id: 2, modelId: 7, referenceName: 'amount' },
    ]);
    mockFindNestedColumnsByModelIds.mockResolvedValue([]);
    mockPreview.mockResolvedValue({
      columns: [
        { name: 'order_id', type: 'number' },
        { name: 'amount', type: 'number' },
      ],
      data: [[1, 100]],
    });
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('returns preview data for a runtime-scoped model through the REST route', async () => {
    const handler = (await import('../v1/models/[id]/preview')).default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(mockGetModelByRuntimeIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      }),
      7,
    );
    expect(mockFindColumnsByModelIds).toHaveBeenCalledWith([7]);
    expect(mockPreview).toHaveBeenCalledWith(
      'select "order_id","amount" from "orders"',
      expect.objectContaining({
        project: expect.objectContaining({ id: 21 }),
        manifest: { schema: [] },
        modelingOnly: false,
        limit: 25,
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'PREVIEW_MODEL_DATA',
        responsePayload: {
          columns: [
            { name: 'order_id', type: 'number' },
            { name: 'amount', type: 'number' },
          ],
          data: [[1, 100]],
        },
      }),
    );
  });

  it('returns the runtime-scoped model list through the REST route', async () => {
    const handler = (await import('../v1/models/list')).default;
    const req = createReq({
      query: {},
    });
    const res = createRes();

    mockFindColumnsByModelIds.mockResolvedValue([
      {
        id: 1,
        modelId: 7,
        displayName: '订单 ID',
        referenceName: 'order_id',
        sourceColumnName: 'order_id',
        type: 'integer',
        isCalculated: false,
        notNull: true,
        expression: null,
        properties: '{"hidden":false}',
      },
      {
        id: 2,
        modelId: 7,
        displayName: '金额',
        referenceName: 'amount',
        sourceColumnName: 'amount',
        type: 'integer',
        isCalculated: true,
        notNull: false,
        expression: 'sum(amount)',
        properties: '{}',
      },
    ]);

    await handler(req, res);

    expect(mockListModelsByRuntimeIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      }),
    );
    expect(mockFindColumnsByModelIds).toHaveBeenCalledWith([7]);
    expect(mockFindNestedColumnsByModelIds).toHaveBeenCalledWith([7]);
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'GET_MODELS',
        responsePayload: [
          expect.objectContaining({
            id: 7,
            displayName: '订单',
            referenceName: 'orders',
            fields: [
              expect.objectContaining({
                id: 1,
                referenceName: 'order_id',
                properties: { hidden: false },
              }),
            ],
            calculatedFields: [
              expect.objectContaining({
                id: 2,
                referenceName: 'amount',
              }),
            ],
            properties: {
              description: '订单表',
            },
          }),
        ],
      }),
    );
  });
});
