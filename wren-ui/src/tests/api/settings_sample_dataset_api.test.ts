export {};

const mockStartSampleDataset = jest.fn();
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
    startSampleDataset: mockStartSampleDataset,
  })),
}));

jest.mock('@/server/api/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

jest.mock('@/server/api/restApi', () => ({
  sendRestApiError: (res: any, error: Error & { statusCode?: number }) =>
    mockSendRestApiError(res, error),
}));

describe('pages/api/v1/settings/sample-dataset route', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      query: {},
      body: {
        name: 'HR',
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
    mockBuildApiContextFromRequest.mockResolvedValue({ runtimeScope: true });
    mockStartSampleDataset.mockResolvedValue({
      name: 'HR',
      projectId: 1,
      runtimeScopeId: 'scope-1',
    });
  });

  it('starts sample dataset import through the rest route', async () => {
    const handler = (await import('../../pages/api/v1/settings/sample-dataset'))
      .default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(mockBuildApiContextFromRequest).toHaveBeenCalledWith({ req });
    expect(mockStartSampleDataset).toHaveBeenCalledWith(
      null,
      { data: { name: 'HR' } },
      { runtimeScope: true },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      name: 'HR',
      projectId: 1,
      runtimeScopeId: 'scope-1',
    });
  });

  it('rejects requests without a dataset name before loading api context', async () => {
    const handler = (await import('../../pages/api/v1/settings/sample-dataset'))
      .default;
    const req = createReq({
      body: {},
    });
    const res = createRes();

    await handler(req, res);

    expect(mockBuildApiContextFromRequest).not.toHaveBeenCalled();
    expect(mockStartSampleDataset).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'Sample dataset name is required',
    });
  });

  it('surfaces policy rejections from the controller', async () => {
    const handler = (await import('../../pages/api/v1/settings/sample-dataset'))
      .default;
    const req = createReq({
      body: {
        name: 'ECOMMERCE',
      },
    });
    const res = createRes();

    const error = new Error(
      '系统样例已集中到系统样例空间，业务工作区不再支持导入样例数据，请直接配置真实数据库连接。',
    ) as Error & { statusCode?: number };
    error.statusCode = 403;
    mockStartSampleDataset.mockRejectedValueOnce(error);

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error:
        '系统样例已集中到系统样例空间，业务工作区不再支持导入样例数据，请直接配置真实数据库连接。',
    });
  });
});
