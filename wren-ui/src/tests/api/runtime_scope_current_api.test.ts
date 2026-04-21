export {};

const mockBuildApiContextFromRequest = jest.fn();
const mockGetRuntimeSelectorState = jest.fn();
const mockSendRestApiError = jest.fn(
  (
    res: any,
    error: Error & {
      statusCode?: number;
    },
  ) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
    return res;
  },
);

jest.mock('@server/controllers/runtimeSelectorController', () => ({
  RuntimeSelectorController: jest.fn().mockImplementation(() => ({
    getRuntimeSelectorState: mockGetRuntimeSelectorState,
  })),
}));

jest.mock('@/server/api/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

jest.mock('@/server/api/restApi', () => ({
  sendRestApiError: mockSendRestApiError,
}));

describe('pages/api/v1/runtime/scope/current route', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      headers: {},
      query: {},
      body: {},
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
    mockBuildApiContextFromRequest.mockResolvedValue({ ctx: true });
    mockGetRuntimeSelectorState.mockResolvedValue({
      currentWorkspace: {
        id: 'ws-1',
      },
    });
  });

  it('builds API context with allowMissingRuntimeScope for bootstrap requests', async () => {
    const handler = (await import('../../pages/api/v1/runtime/scope/current'))
      .default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(mockBuildApiContextFromRequest).toHaveBeenCalledWith({
      req,
      allowMissingRuntimeScope: true,
    });
    expect(mockGetRuntimeSelectorState).toHaveBeenCalledWith({
      ctx: { ctx: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      currentWorkspace: {
        id: 'ws-1',
      },
    });
  });

  it('retries with a null runtime scope when the selector cannot be resolved', async () => {
    const handler = (await import('../../pages/api/v1/runtime/scope/current'))
      .default;
    const req = createReq();
    const res = createRes();

    mockBuildApiContextFromRequest
      .mockRejectedValueOnce(new Error('Workspace scope could not be resolved'))
      .mockResolvedValueOnce({ ctx: 'fallback' });

    await handler(req, res);

    expect(mockBuildApiContextFromRequest).toHaveBeenNthCalledWith(1, {
      req,
      allowMissingRuntimeScope: true,
    });
    expect(mockBuildApiContextFromRequest).toHaveBeenNthCalledWith(2, {
      req,
      runtimeScope: null,
      allowMissingRuntimeScope: true,
    });
    expect(mockGetRuntimeSelectorState).toHaveBeenCalledWith({
      ctx: { ctx: 'fallback' },
    });
    expect(res.statusCode).toBe(200);
  });
});
