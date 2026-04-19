export {};

const mockBuildApiContextFromRequest = jest.fn();
const mockDeploy = jest.fn();

jest.mock('@server/controllers/modelController', () => ({
  ModelController: jest.fn().mockImplementation(() => ({
    deploy: mockDeploy,
  })),
}));

jest.mock('@/server/api/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

describe('pages/api/v1/internal/deploy route', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      headers: {
        'x-wren-ai-service-internal': '1',
      },
      body: {
        force: true,
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
    mockBuildApiContextFromRequest.mockResolvedValue({ ctx: true });
    mockDeploy.mockResolvedValue({ status: 'SUCCESS' });
  });

  it('allows internal ai-service callers to trigger force deploy over rest', async () => {
    const handler = (await import('../v1/internal/deploy')).default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(mockBuildApiContextFromRequest).toHaveBeenCalledWith({ req });
    expect(mockDeploy).toHaveBeenCalledWith({
      force: true,
      ctx: { ctx: true },
      allowInternalBypass: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'SUCCESS' });
  });

  it('rejects non-internal callers', async () => {
    const handler = (await import('../v1/internal/deploy')).default;
    const req = createReq({ headers: {} });
    const res = createRes();

    await handler(req, res);

    expect(mockBuildApiContextFromRequest).not.toHaveBeenCalled();
    expect(mockDeploy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Internal AI-service access required' });
  });
});
