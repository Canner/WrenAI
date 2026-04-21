export {};

const mockResolveRuntimeScopeId = jest.fn();
const mockBuildApiContextFromRequest = jest.fn();
const mockPreviewSql = jest.fn();

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: {
      resolveRuntimeScopeId: mockResolveRuntimeScopeId,
    },
  },
}));

jest.mock('@server/controllers/modelController', () => ({
  ModelController: jest.fn().mockImplementation(() => ({
    previewSql: mockPreviewSql,
  })),
}));

jest.mock('@/server/api/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

describe('pages/api/v1/internal/sql/preview route', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      headers: {
        'x-wren-ai-service-internal': '1',
      },
      body: {
        sql: 'select 1',
        runtimeScopeId: 'runtime-1',
        dryRun: true,
        limit: 1,
      },
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
    mockResolveRuntimeScopeId.mockResolvedValue({
      selector: { runtimeScopeId: 'runtime-1' },
    });
    mockBuildApiContextFromRequest.mockResolvedValue({ ctx: true });
    mockPreviewSql.mockResolvedValue({
      columns: [{ name: 'value', type: 'integer' }],
      data: [[1]],
      correlationId: 'corr-1',
    });
  });

  it('returns preview data for internal ai-service callers', async () => {
    const handler = (await import('../../pages/api/v1/internal/sql/preview'))
      .default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(mockResolveRuntimeScopeId).toHaveBeenCalledWith('runtime-1');
    expect(mockBuildApiContextFromRequest).toHaveBeenCalledWith({
      req,
      runtimeScope: { selector: { runtimeScopeId: 'runtime-1' } },
    });
    expect(mockPreviewSql).toHaveBeenCalledWith({
      data: {
        sql: 'select 1',
        runtimeScopeId: 'runtime-1',
        dryRun: true,
        limit: 1,
      },
      ctx: { ctx: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      data: {
        columns: [{ name: 'value', type: 'integer' }],
        data: [[1]],
        correlationId: 'corr-1',
      },
      correlationId: 'corr-1',
    });
  });

  it('serializes preview errors into the ai-service rest contract', async () => {
    const handler = (await import('../../pages/api/v1/internal/sql/preview'))
      .default;
    const req = createReq();
    const res = createRes();
    const error = Object.assign(new Error('Invalid SQL'), {
      extensions: {
        other: {
          correlationId: 'corr-bad',
          metadata: {
            dialectSql: 'select * from broken',
            plannedSql: 'planned sql',
          },
        },
      },
    });
    mockPreviewSql.mockRejectedValue(error);

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: {
        message: 'Invalid SQL',
        dialectSql: 'select * from broken',
        plannedSql: 'planned sql',
      },
      correlationId: 'corr-bad',
    });
  });
});
