export {};

const mockListConnectionTables = jest.fn();
const mockBuildApiContextFromRequest = jest.fn();
const mockSendRestApiError = jest.fn(
  (res: any, error: Error & { statusCode?: number }) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
    return res;
  },
);

jest.mock('@server/controllers/projectController', () => ({
  ProjectController: jest.fn().mockImplementation(() => ({
    listConnectionTables: mockListConnectionTables,
  })),
}));

jest.mock('@/server/api/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

jest.mock('@/server/api/restApi', () => ({
  sendRestApiError: (res: any, error: Error & { statusCode?: number }) =>
    mockSendRestApiError(res, error),
}));

describe('pages/api/v1/data-source/tables route', () => {
  const createRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      headers: {} as Record<string, string>,
    } as any;
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload: any) => {
      res.body = payload;
      return res;
    };
    res.setHeader = jest.fn((name: string, value: string) => {
      res.headers[name] = value;
    });
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildApiContextFromRequest.mockResolvedValue({ runtimeScope: true });
  });

  it('serves the legacy alias without depending on the canonical route module', async () => {
    const handler = (await import('../v1/data-source/tables')).default;
    const req = { method: 'GET' } as any;
    const res = createRes();
    mockListConnectionTables.mockResolvedValue([{ name: 'orders' }]);

    await handler(req, res);

    expect(mockBuildApiContextFromRequest).toHaveBeenCalledWith({ req });
    expect(mockListConnectionTables).toHaveBeenCalledWith({
      ctx: { runtimeScope: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ name: 'orders' }]);
  });

  it('marks the legacy alias as deprecated and points callers to the canonical route', async () => {
    const handler = (await import('../v1/data-source/tables')).default;
    const req = { method: 'GET' } as any;
    const res = createRes();
    mockListConnectionTables.mockResolvedValue([]);

    await handler(req, res);

    expect(res.headers.Deprecation).toBe('true');
    expect(res.headers.Link).toBe(
      '</api/v1/connection/tables>; rel="successor-version"',
    );
    expect(res.headers.Warning).toBe(
      '299 - "Deprecated API: use /api/v1/connection/tables for connection table lookups."',
    );
  });
});
