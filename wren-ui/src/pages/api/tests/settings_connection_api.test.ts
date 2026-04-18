export {};

const mockSaveConnection = jest.fn();
const mockUpdateConnection = jest.fn();
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
    saveConnection: mockSaveConnection,
    updateConnection: mockUpdateConnection,
  })),
}));

jest.mock('../v1/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

jest.mock('../v1/restApi', () => ({
  sendRestApiError: (res: any, error: Error & { statusCode?: number }) =>
    mockSendRestApiError(res, error),
}));

describe('pages/api/v1/settings/connection route', () => {
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

  it('creates a knowledge connection through the connector-oriented route', async () => {
    const handler = (await import('../v1/settings/connection')).default;
    const req = {
      method: 'POST',
      body: {
        type: 'POSTGRES',
        properties: { displayName: 'Warehouse', host: 'db' },
      },
    } as any;
    const res = createRes();
    mockSaveConnection.mockResolvedValue({
      type: 'POSTGRES',
      properties: { displayName: 'Warehouse', host: 'db' },
    });

    await handler(req, res);

    expect(mockBuildApiContextFromRequest).toHaveBeenCalledWith({ req });
    expect(mockSaveConnection).toHaveBeenCalledWith(
      null,
      {
        data: {
          type: 'POSTGRES',
          properties: { displayName: 'Warehouse', host: 'db' },
        },
      },
      { runtimeScope: true },
    );
    expect(res.statusCode).toBe(201);
  });

  it('updates a knowledge connection through the connector-oriented route', async () => {
    const handler = (await import('../v1/settings/connection')).default;
    const req = {
      method: 'PATCH',
      body: {
        type: 'POSTGRES',
        properties: { displayName: 'Warehouse', host: 'db-2' },
      },
    } as any;
    const res = createRes();
    mockUpdateConnection.mockResolvedValue({
      type: 'POSTGRES',
      properties: { displayName: 'Warehouse', host: 'db-2' },
    });

    await handler(req, res);

    expect(mockUpdateConnection).toHaveBeenCalledWith(
      null,
      {
        data: {
          type: 'POSTGRES',
          properties: { displayName: 'Warehouse', host: 'db-2' },
        },
      },
      { runtimeScope: true },
    );
    expect(res.statusCode).toBe(200);
  });
});
