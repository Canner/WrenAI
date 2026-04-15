export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockCount = jest.fn();
const mockFindAllWithPagination = jest.fn();
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
    apiHistoryRepository: {
      count: mockCount,
      findAllWithPagination: mockFindAllWithPagination,
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

describe('pages/api/v1/api-history route', () => {
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
      method: 'GET',
      query: {},
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('returns filtered api history with sanitized payloads through the REST endpoint', async () => {
    const handler = (await import('../v1/api-history')).default;
    const req = createReq({
      method: 'GET',
      query: {
        apiType: 'RUN_SQL',
        statusCode: '400',
        threadId: 'thread-1',
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-04-03T23:59:59.999Z',
        offset: '10',
        limit: '20',
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockCount.mockResolvedValue(24);
    mockFindAllWithPagination.mockResolvedValue([
      {
        id: 'history-1',
        apiType: 'RUN_SQL',
        threadId: 'thread-1',
        requestPayload: { sql: 'select 1' },
        responsePayload: { records: [{ id: 1 }, { id: 2 }] },
        statusCode: 400,
        durationMs: 123,
        createdAt: '2026-04-02T01:02:03.000Z',
        updatedAt: '2026-04-02T01:02:03.000Z',
      },
    ]);

    await handler(req, res);

    expect(mockCount).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        apiType: 'RUN_SQL',
        statusCode: 400,
        threadId: 'thread-1',
      }),
      {
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        endDate: new Date('2026-04-03T23:59:59.999Z'),
      },
    );
    expect(mockFindAllWithPagination).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        apiType: 'RUN_SQL',
      }),
      {
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        endDate: new Date('2026-04-03T23:59:59.999Z'),
      },
      {
        offset: 10,
        limit: 20,
        orderBy: { createdAt: 'desc' },
      },
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'GET_API_HISTORY',
        responsePayload: {
          items: [
            expect.objectContaining({
              id: 'history-1',
              responsePayload: {
                records: ['2 records omitted'],
              },
            }),
          ],
          total: 24,
          hasMore: false,
        },
      }),
    );
  });

  it('preserves chart metadata while omitting raw vegaSpec values', async () => {
    const handler = (await import('../v1/api-history')).default;
    const req = createReq({
      method: 'GET',
      query: {
        apiType: 'GENERATE_VEGA_CHART',
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockCount.mockResolvedValue(1);
    mockFindAllWithPagination.mockResolvedValue([
      {
        id: 'history-chart-1',
        apiType: 'GENERATE_VEGA_CHART',
        threadId: 'thread-chart-1',
        requestPayload: { question: '按地区看销售额' },
        responsePayload: {
          canonicalizationVersion: 'chart-canonical-v1',
          renderHints: { preferredRenderer: 'canvas' },
          chartDataProfile: {
            sourceRowCount: 30,
            resultRowCount: 26,
          },
          vegaSpec: {
            data: { values: [{ x: 1 }, { x: 2 }] },
          },
        },
        statusCode: 200,
        durationMs: 55,
        createdAt: '2026-04-02T01:02:03.000Z',
        updatedAt: '2026-04-02T01:02:03.000Z',
      },
    ]);

    await handler(req, res);

    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        responsePayload: expect.objectContaining({
          items: [
            expect.objectContaining({
              responsePayload: {
                canonicalizationVersion: 'chart-canonical-v1',
                renderHints: { preferredRenderer: 'canvas' },
                chartDataProfile: {
                  sourceRowCount: 30,
                  resultRowCount: 26,
                },
                vegaSpec: {
                  data: {
                    values: ['2 data points omitted'],
                  },
                },
              },
            }),
          ],
        }),
      }),
    );
  });

  it('returns 400 for an invalid api type filter', async () => {
    const handler = (await import('../v1/api-history')).default;
    const req = createReq({
      method: 'GET',
      query: {
        apiType: 'INVALID_TYPE',
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());

    await handler(req, res);

    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'apiType is invalid' });
  });
});
