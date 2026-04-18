const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockListConnectorsByKnowledgeBase = jest.fn();
const mockListConnectorsByWorkspace = jest.fn();
const mockCreateConnector = jest.fn();
const mockGetConnectorById = jest.fn();
const mockUpdateConnector = jest.fn();
const mockDeleteConnector = jest.fn();
const mockTestConnectorConnection = jest.fn();
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
    connectorService: {
      listConnectorsByKnowledgeBase: mockListConnectorsByKnowledgeBase,
      listConnectorsByWorkspace: mockListConnectorsByWorkspace,
      createConnector: mockCreateConnector,
      getConnectorById: mockGetConnectorById,
      updateConnector: mockUpdateConnector,
      deleteConnector: mockDeleteConnector,
      testConnectorConnection: mockTestConnectorConnection,
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
  },
}));

jest.mock('@/server/utils/apiUtils', () => ({
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

  it('lists connectors within the active runtime knowledge base', async () => {
    const handler = (await import('../v1/connectors')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockListConnectorsByKnowledgeBase.mockResolvedValue([
      {
        id: 'connector-1',
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        type: 'database',
        databaseProvider: 'postgres',
        trinoCatalogName: 'kb_kb1_con1',
        displayName: 'Warehouse',
        configJson: { host: 'db.internal', port: 5432 },
        secretRecordId: 'secret-1',
      },
    ]);

    await handler(req, res);

    expect(mockListConnectorsByKnowledgeBase).toHaveBeenCalledWith(
      'ws-1',
      'kb-1',
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        runtimeScope: expect.objectContaining({
          project: { id: 21 },
        }),
        responsePayload: [
          expect.objectContaining({
            id: 'connector-1',
            databaseProvider: 'postgres',
            trinoCatalogName: 'kb_kb1_con1',
            hasSecret: true,
          }),
        ],
      }),
    );
  });

  it('lists workspace connectors when no knowledge base scope is present', async () => {
    const handler = (await import('../v1/connectors')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({ knowledgeBase: null, project: null }),
    );
    mockListConnectorsByWorkspace.mockResolvedValue([
      {
        id: 'connector-workspace-1',
        workspaceId: 'ws-1',
        knowledgeBaseId: null,
        type: 'database',
        databaseProvider: 'postgres',
        displayName: 'Workspace Warehouse',
        configJson: { host: 'db.internal', port: 5432 },
        secretRecordId: 'secret-1',
      },
    ]);

    await handler(req, res);

    expect(mockListConnectorsByWorkspace).toHaveBeenCalledWith('ws-1');
    expect(mockListConnectorsByKnowledgeBase).not.toHaveBeenCalled();
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        responsePayload: [
          expect.objectContaining({
            id: 'connector-workspace-1',
            knowledgeBaseId: null,
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

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({
        project: { id: 22 },
        knowledgeBase: { id: 'kb-2', kind: 'regular' },
      }),
    );
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
      databaseProvider: null,
      displayName: 'Weather API',
      config: { baseUrl: 'https://weather.example.com' },
      secret: { apiKey: 'secret-token' },
      createdBy: 'user-1',
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 201,
        runtimeScope: expect.objectContaining({
          project: { id: 22 },
        }),
        responsePayload: expect.objectContaining({
          id: 'connector-2',
          hasSecret: true,
        }),
      }),
    );
  });

  it('creates a workspace-scoped connector when no knowledge base scope is present', async () => {
    const handler = (await import('../v1/connectors')).default;
    const req = createReq({
      method: 'POST',
      body: {
        type: 'database',
        databaseProvider: 'postgres',
        displayName: 'Workspace Warehouse',
        config: { host: 'db.internal', port: 5432 },
        secret: { password: 'secret-token' },
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({ knowledgeBase: null, project: null }),
    );
    mockCreateConnector.mockResolvedValue({
      id: 'connector-workspace-create-1',
      workspaceId: 'ws-1',
      knowledgeBaseId: null,
      type: 'database',
      databaseProvider: 'postgres',
      displayName: 'Workspace Warehouse',
      configJson: { host: 'db.internal', port: 5432 },
      secretRecordId: 'secret-workspace-1',
      createdBy: 'user-1',
    });

    await handler(req, res);

    expect(mockCreateConnector).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      knowledgeBaseId: undefined,
      type: 'database',
      databaseProvider: 'postgres',
      displayName: 'Workspace Warehouse',
      config: { host: 'db.internal', port: 5432 },
      secret: { password: 'secret-token' },
      createdBy: 'user-1',
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 201,
        responsePayload: expect.objectContaining({
          id: 'connector-workspace-create-1',
          knowledgeBaseId: null,
        }),
      }),
    );
  });

  it('returns 403 for connector creation in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
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

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({
        actorClaims: {
          workspaceId: 'ws-1',
          workspaceMemberId: 'member-1',
          roleKeys: ['owner'],
          permissionScopes: ['workspace:*'],
          grantedActions: [],
          workspaceRoleSource: 'legacy',
          platformRoleSource: 'legacy',
        },
      }),
    );

    await handler(req, res);

    expect(mockCreateConnector).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: expect.stringMatching(/permission required/i),
    });
  });

  it('passes databaseProvider through create requests for database connectors', async () => {
    const handler = (await import('../v1/connectors')).default;
    const req = createReq({
      method: 'POST',
      body: {
        type: 'database',
        databaseProvider: 'postgres',
        displayName: 'Warehouse',
        config: {
          host: '127.0.0.1',
          port: '5432',
          database: 'analytics',
          user: 'postgres',
        },
        secret: { password: 'postgres' },
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({
        project: { id: 22 },
        knowledgeBase: { id: 'kb-2', kind: 'regular' },
      }),
    );
    mockCreateConnector.mockResolvedValue({
      id: 'connector-db-1',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-2',
      type: 'database',
      databaseProvider: 'postgres',
      trinoCatalogName: null,
      displayName: 'Warehouse',
      configJson: {
        host: '127.0.0.1',
        port: '5432',
        database: 'analytics',
        user: 'postgres',
      },
      secretRecordId: 'secret-db-1',
      createdBy: 'user-1',
    });

    await handler(req, res);

    expect(mockCreateConnector).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-2',
      type: 'database',
      databaseProvider: 'postgres',
      displayName: 'Warehouse',
      config: {
        host: '127.0.0.1',
        port: '5432',
        database: 'analytics',
        user: 'postgres',
      },
      secret: { password: 'postgres' },
      createdBy: 'user-1',
    });
  });

  it('rejects connector creation in system sample scopes before hitting the service', async () => {
    const handler = (await import('../v1/connectors')).default;
    const req = createReq({
      method: 'POST',
      body: {
        type: 'database',
        displayName: 'Blocked sample connector',
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({
        workspace: { id: 'ws-default', kind: 'default' },
        knowledgeBase: { id: 'kb-sample', kind: 'system_sample' },
        actorClaims: {
          workspaceId: 'ws-default',
          workspaceMemberId: 'member-1',
          roleKeys: ['owner'],
          permissionScopes: ['workspace:*'],
        },
      }),
    );

    await handler(req, res);

    expect(mockCreateConnector).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: '系统样例知识库不支持接入或管理连接器',
    });
  });

  it('rejects connector detail access when record belongs to another knowledge base', async () => {
    const handler = (await import('../v1/connectors/[id]')).default;
    const req = createReq({
      method: 'GET',
      query: { id: 'connector-7' },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({ project: { id: 23 } }),
    );
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

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({ project: { id: 24 } }),
    );
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
      databaseProvider: undefined,
      displayName: 'Updated connector',
      config: { timeoutMs: 3000 },
      secret: undefined,
    });
    expect(mockDeleteConnector).toHaveBeenCalledWith('connector-8');
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 204,
        runtimeScope: expect.objectContaining({
          project: { id: 24 },
        }),
      }),
    );
  });

  it('allows workspace-level connector management routes without a knowledge base scope', async () => {
    const detailHandler = (await import('../v1/connectors/[id]')).default;
    const testHandler = (await import('../v1/connectors/test')).default;
    const detailReq = createReq({
      method: 'GET',
      query: { id: 'connector-workspace-2' },
    });
    const updateReq = createReq({
      method: 'PUT',
      query: { id: 'connector-workspace-2' },
      body: { displayName: 'Workspace Connector' },
    });
    const testReq = createReq({
      method: 'POST',
      body: { connectorId: 'connector-workspace-2' },
    });
    const detailRes = createRes();
    const updateRes = createRes();
    const testRes = createRes();

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({ knowledgeBase: null, project: null }),
    );
    mockGetConnectorById.mockResolvedValue({
      id: 'connector-workspace-2',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-9',
      type: 'database',
      databaseProvider: 'postgres',
      displayName: 'Workspace Connector',
      configJson: null,
      secretRecordId: null,
    });
    mockUpdateConnector.mockResolvedValue({
      id: 'connector-workspace-2',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-9',
      type: 'database',
      databaseProvider: 'postgres',
      displayName: 'Workspace Connector',
      configJson: null,
      secretRecordId: null,
    });
    mockTestConnectorConnection.mockResolvedValue({
      success: true,
      connectorType: 'database',
      message: '数据库连接测试成功',
      tableCount: 1,
      sampleTables: ['orders'],
    });

    await detailHandler(detailReq, detailRes);
    await detailHandler(updateReq, updateRes);
    await testHandler(testReq, testRes);

    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        responsePayload: expect.objectContaining({
          id: 'connector-workspace-2',
          knowledgeBaseId: 'kb-9',
        }),
      }),
    );
    expect(mockUpdateConnector).toHaveBeenCalledWith('connector-workspace-2', {
      knowledgeBaseId: undefined,
      type: undefined,
      databaseProvider: undefined,
      displayName: 'Workspace Connector',
      config: undefined,
      secret: undefined,
    });
    expect(mockTestConnectorConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        connectorId: 'connector-workspace-2',
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

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({ project: { id: 25 } }),
    );
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
      databaseProvider: undefined,
      displayName: 'Updated connector',
      config: undefined,
      secret: null,
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        runtimeScope: expect.objectContaining({
          project: { id: 25 },
        }),
        responsePayload: expect.objectContaining({
          id: 'connector-9',
          hasSecret: false,
        }),
      }),
    );
  });

  it('rejects connector updates in system sample scopes before hitting the service', async () => {
    const handler = (await import('../v1/connectors/[id]')).default;
    const req = createReq({
      method: 'PUT',
      query: { id: 'connector-sample' },
      body: {
        displayName: 'Blocked update',
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({
        workspace: { id: 'ws-default', kind: 'default' },
        knowledgeBase: { id: 'kb-sample', kind: 'system_sample' },
        actorClaims: {
          workspaceId: 'ws-default',
          workspaceMemberId: 'member-1',
          roleKeys: ['owner'],
          permissionScopes: ['workspace:*'],
        },
      }),
    );

    await handler(req, res);

    expect(mockGetConnectorById).not.toHaveBeenCalled();
    expect(mockUpdateConnector).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: '系统样例知识库不支持接入或管理连接器',
    });
  });

  it('tests an ad-hoc connector payload inside the active runtime scope', async () => {
    const handler = (await import('../v1/connectors/test')).default;
    const req = createReq({
      method: 'POST',
      body: {
        type: 'database',
        databaseProvider: 'postgres',
        config: {
          host: '127.0.0.1',
          port: '5432',
          database: 'analytics',
          username: 'postgres',
        },
        secret: { password: 'postgres' },
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockTestConnectorConnection.mockResolvedValue({
      success: true,
      connectorType: 'database',
      message: '数据库连接测试成功，已发现 2 张表',
      tableCount: 2,
      sampleTables: ['orders', 'customers'],
    });

    await handler(req, res);

    expect(mockTestConnectorConnection).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      type: 'database',
      databaseProvider: 'postgres',
      config: {
        host: '127.0.0.1',
        port: '5432',
        database: 'analytics',
        username: 'postgres',
      },
      secret: { password: 'postgres' },
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        responsePayload: expect.objectContaining({
          success: true,
          tableCount: 2,
        }),
      }),
    );
  });

  it('tests an existing connector only when it belongs to the active knowledge base', async () => {
    const handler = (await import('../v1/connectors/test')).default;
    const req = createReq({
      method: 'POST',
      body: {
        connectorId: 'connector-10',
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockGetConnectorById.mockResolvedValue({
      id: 'connector-10',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      type: 'database',
      databaseProvider: 'postgres',
    });
    mockTestConnectorConnection.mockResolvedValue({
      success: true,
      connectorType: 'database',
      message: '数据库连接测试成功，但当前库中没有可见表',
      tableCount: 0,
      sampleTables: [],
    });

    await handler(req, res);

    expect(mockGetConnectorById).toHaveBeenCalledWith('connector-10');
    expect(mockTestConnectorConnection).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      connectorId: 'connector-10',
    });
  });

  it('rejects ad-hoc connector tests in system sample scopes before hitting the service', async () => {
    const handler = (await import('../v1/connectors/test')).default;
    const req = createReq({
      method: 'POST',
      body: {
        type: 'database',
        databaseProvider: 'postgres',
        config: {
          host: '127.0.0.1',
          port: '5432',
          database: 'analytics',
          username: 'postgres',
        },
        secret: { password: 'postgres' },
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({
        workspace: { id: 'ws-default', kind: 'default' },
        knowledgeBase: { id: 'kb-sample', kind: 'system_sample' },
        actorClaims: {
          workspaceId: 'ws-default',
          workspaceMemberId: 'member-1',
          roleKeys: ['owner'],
          permissionScopes: ['workspace:*'],
        },
      }),
    );

    await handler(req, res);

    expect(mockTestConnectorConnection).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: '系统样例知识库不支持接入或管理连接器',
    });
  });
});

export {};
