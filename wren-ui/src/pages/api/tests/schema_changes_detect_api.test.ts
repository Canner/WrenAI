export {};

const mockTriggerConnectionDetection = jest.fn();
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
    triggerConnectionDetection: mockTriggerConnectionDetection,
  })),
}));

jest.mock('../v1/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

jest.mock('../v1/restApi', () => ({
  sendRestApiError: (res: any, error: Error & { statusCode?: number }) =>
    mockSendRestApiError(res, error),
}));

describe('pages/api/v1/schema-changes/detect route', () => {
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
  });

  it('triggers connection schema detection through the REST route', async () => {
    const handler = (await import('../v1/schema-changes/detect')).default;
    const req = { method: 'POST', body: {} } as any;
    const res = createRes();
    mockTriggerConnectionDetection.mockResolvedValue(true);

    await handler(req, res);

    expect(mockBuildApiContextFromRequest).toHaveBeenCalledWith({ req });
    expect(mockTriggerConnectionDetection).toHaveBeenCalledWith(
      null,
      null,
      { runtimeScope: true },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(true);
  });
});
