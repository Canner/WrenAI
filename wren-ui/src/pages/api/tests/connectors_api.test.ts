const mockResolveRequestScope = jest.fn();
const mockListConnectorsByKnowledgeBase = jest.fn();
const mockCreateConnector = jest.fn();
const mockGetConnectorById = jest.fn();
const mockUpdateConnector = jest.fn();
const mockDeleteConnector = jest.fn();
const mockRespondWithSimple = jest.fn();
const mockHandleApiError = jest.fn(
  async ({ error, res }: { error: Error & { statusCode?: number }; res: any }) => {
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
    connectorService: {
      listConnectorsByKnowledgeBase: mockListConnectorsByKnowledgeBase,
      createConnector: mockCreateConnector,
      getConnectorById: mockGetConnectorById,
      updateConnector: mockUpdateConnector,
      deleteConnector: mockDeleteConnector,
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

describe('pages/api/v1/connectors routes', () => {
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
    jest.clearAllMocks();
  });

  it('lists connectors within the active runtime knowledge base', async () => {
    const handler = (await import('../v1/connectors')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 21 },
      workspace: { id: 'ws-1' },
      knowledgeBase: { id: 'kb-1' },
    });
    mockListConnectorsByKnowledgeBase.mockResolvedValue([
      {
        id: 'connector-1',
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        type: 'rest_json',
        displayName: 'Sales API',
        configJson: { baseUrl: 'https://api.example.com' },
        secretRecordId: 'secret-1',
      },
    ]);

    await handler(req, res);

    expect(mockListConnectorsByKnowledgeBase).toHaveBeenCalledWith('kb-1');
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        projectId: 21,
        responsePayload: [
          expect.objectContaining({
            id: 'connector-1',
            hasSecret: true,
          }),
        ],
      }),
    );
  });

  it('creates a knowledge-base-scoped connector with secret payload', async () => {
    const handler = (await import('../v1/connectors')).default;
    const req = createReq({
      method: 'POST',
      body: {
        type: 'rest_json',
        displayName: 'Weather API',
        config: { baseUrl: 'https://weather.example.com' },
        secret: { apiKey: 'secret-token' },
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 22 },
      workspace: { id: 'ws-1' },
      knowledgeBase: { id: 'kb-2' },
      userId: 'user-1',
    });
    mockCreateConnector.mockResolvedValue({
      id: 'connector-2',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-2',
      type: 'rest_json',
      displayName: 'Weather API',
      configJson: { baseUrl: 'https://weather.example.com' },
      secretRecordId: 'secret-2',
      createdBy: 'user-1',
    });

    await handler(req, res);

    expect(mockCreateConnector).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-2',
      type: 'rest_json',
      displayName: 'Weather API',
      config: { baseUrl: 'https://weather.example.com' },
      secret: { apiKey: 'secret-token' },
      createdBy: 'user-1',
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 201,
        projectId: 22,
        responsePayload: expect.objectContaining({
          id: 'connector-2',
          hasSecret: true,
        }),
      }),
    );
  });

  it('rejects connector detail access when record belongs to another knowledge base', async () => {
    const handler = (await import('../v1/connectors/[id]')).default;
    const req = createReq({
      method: 'GET',
      query: { id: 'connector-7' },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 23 },
      workspace: { id: 'ws-1' },
      knowledgeBase: { id: 'kb-1' },
    });
    mockGetConnectorById.mockResolvedValue({
      id: 'connector-7',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-2',
    });

    await handler(req, res);

    expect(mockGetConnectorById).toHaveBeenCalledWith('connector-7');
    expect(mockRespondWithSimple).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Connector not found' });
  });

  it('updates and deletes a scoped connector', async () => {
    const handler = (await import('../v1/connectors/[id]')).default;
    const updateReq = createReq({
      method: 'PUT',
      query: { id: 'connector-8' },
      body: {
        displayName: 'Updated connector',
        config: { timeoutMs: 3000 },
      },
    });
    const deleteReq = createReq({
      method: 'DELETE',
      query: { id: 'connector-8' },
    });
    const updateRes = createRes();
    const deleteRes = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 24 },
      workspace: { id: 'ws-1' },
      knowledgeBase: { id: 'kb-1' },
    });
    mockGetConnectorById.mockResolvedValue({
      id: 'connector-8',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      type: 'rest_json',
      displayName: 'Old connector',
      configJson: null,
      secretRecordId: null,
    });
    mockUpdateConnector.mockResolvedValue({
      id: 'connector-8',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      type: 'rest_json',
      displayName: 'Updated connector',
      configJson: { timeoutMs: 3000 },
      secretRecordId: null,
    });

    await handler(updateReq, updateRes);
    await handler(deleteReq, deleteRes);

    expect(mockUpdateConnector).toHaveBeenCalledWith('connector-8', {
      knowledgeBaseId: 'kb-1',
      type: undefined,
      displayName: 'Updated connector',
      config: { timeoutMs: 3000 },
      secret: undefined,
    });
    expect(mockDeleteConnector).toHaveBeenCalledWith('connector-8');
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 204,
        projectId: 24,
      }),
    );
  });

  it('passes secret: null through update requests to clear connector secret', async () => {
    const handler = (await import('../v1/connectors/[id]')).default;
    const req = createReq({
      method: 'PUT',
      query: { id: 'connector-9' },
      body: {
        displayName: 'Updated connector',
        secret: null,
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 25 },
      workspace: { id: 'ws-1' },
      knowledgeBase: { id: 'kb-1' },
    });
    mockGetConnectorById.mockResolvedValue({
      id: 'connector-9',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      type: 'rest_json',
      displayName: 'Old connector',
      configJson: null,
      secretRecordId: 'secret-9',
    });
    mockUpdateConnector.mockResolvedValue({
      id: 'connector-9',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      type: 'rest_json',
      displayName: 'Updated connector',
      configJson: null,
      secretRecordId: null,
    });

    await handler(req, res);

    expect(mockUpdateConnector).toHaveBeenCalledWith('connector-9', {
      knowledgeBaseId: 'kb-1',
      type: undefined,
      displayName: 'Updated connector',
      config: undefined,
      secret: null,
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        projectId: 25,
        responsePayload: expect.objectContaining({
          id: 'connector-9',
          hasSecret: false,
        }),
      }),
    );
  });
});

export {};
