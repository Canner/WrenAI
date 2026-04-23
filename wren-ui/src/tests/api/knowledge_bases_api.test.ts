const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockListKnowledgeBases = jest.fn();
const mockGetKnowledgeBaseById = jest.fn();
const mockCreateKnowledgeBase = jest.fn();
const mockUpdateKnowledgeBase = jest.fn();
const mockGetPrimaryConnector = jest.fn();
const mockFindKbSnapshot = jest.fn();
const mockFindAllKbSnapshots = jest.fn();
const mockFindModelsByRuntimeIdentity = jest.fn();
const mockFindViewsByRuntimeIdentity = jest.fn();
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
    knowledgeBaseService: {
      listKnowledgeBases: mockListKnowledgeBases,
      getKnowledgeBaseById: mockGetKnowledgeBaseById,
      createKnowledgeBase: mockCreateKnowledgeBase,
      updateKnowledgeBase: mockUpdateKnowledgeBase,
      getPrimaryConnector: mockGetPrimaryConnector,
    },
    kbSnapshotRepository: {
      findOneBy: mockFindKbSnapshot,
      findAllBy: mockFindAllKbSnapshots,
    },
    modelRepository: {
      findAllByRuntimeIdentity: mockFindModelsByRuntimeIdentity,
    },
    viewRepository: {
      findAllByRuntimeIdentity: mockFindViewsByRuntimeIdentity,
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

describe('pages/api/v1/knowledge/bases routes', () => {
  const runtimeScope = {
    workspace: { id: 'ws-1', name: 'Workspace Alpha', kind: 'regular' },
    knowledgeBase: { id: 'kb-current' },
    kbSnapshot: { id: 'snap-current' },
    deployment: null,
    project: null,
    deployHash: 'deploy-current',
    userId: 'user-1',
    actorClaims: {
      roleKeys: ['owner'],
    },
  };

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      query: {},
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () =>
    ({
      statusCode: 200,
      body: null,
      setHeader: jest.fn(),
    }) as any;

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(runtimeScope);
    mockFindKbSnapshot.mockResolvedValue(null);
    mockFindAllKbSnapshots.mockResolvedValue([]);
    mockFindModelsByRuntimeIdentity.mockResolvedValue([]);
    mockFindViewsByRuntimeIdentity.mockResolvedValue([]);
    mockGetPrimaryConnector.mockResolvedValue(null);
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('lists active knowledge bases with runtime settings and hydrated relations', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/bases'))
      .default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-older',
        workspaceId: 'ws-1',
        slug: 'older',
        name: 'Older KB',
        kind: 'regular',
        updatedAt: '2026-04-09T09:00:00.000Z',
        defaultKbSnapshotId: 'snap-older',
        primaryConnectorId: 'connector-older',
        runtimeProjectId: 701,
        language: 'en',
        sampleDataset: 'ecommerce',
        archivedAt: null,
      },
      {
        id: 'kb-newer',
        workspaceId: 'ws-1',
        slug: 'newer',
        name: 'Newer KB',
        kind: 'regular',
        updatedAt: '2026-04-10T09:00:00.000Z',
        defaultKbSnapshotId: 'snap-newer',
        primaryConnectorId: null,
        language: 'zh-TW',
        sampleDataset: null,
        archivedAt: null,
      },
      {
        id: 'kb-archived',
        workspaceId: 'ws-1',
        slug: 'archived',
        name: 'Archived KB',
        kind: 'regular',
        updatedAt: '2026-04-11T09:00:00.000Z',
        archivedAt: '2026-04-11T10:00:00.000Z',
      },
    ]);
    mockFindKbSnapshot.mockImplementation(async ({ id }: { id: string }) => {
      if (id === 'snap-newer') {
        return {
          id: 'snap-newer',
          snapshotKey: 'snapshot-newer',
          displayName: 'Snapshot Newer',
          deployHash: 'deploy-newer',
          status: 'ready',
        };
      }
      if (id === 'snap-older') {
        return {
          id: 'snap-older',
          snapshotKey: 'snapshot-older',
          displayName: 'Snapshot Older',
          deployHash: 'deploy-older',
          status: 'ready',
        };
      }
      return null;
    });
    mockFindAllKbSnapshots.mockImplementation(
      async ({ knowledgeBaseId }: { knowledgeBaseId: string }) => {
        if (knowledgeBaseId === 'kb-newer') {
          return [{ id: 'snap-newer' }, { id: 'snap-newer-2' }];
        }
        if (knowledgeBaseId === 'kb-older') {
          return [{ id: 'snap-older' }];
        }
        return [];
      },
    );
    mockFindModelsByRuntimeIdentity.mockImplementation(
      async (runtimeIdentity) =>
        runtimeIdentity.knowledgeBaseId === 'kb-newer'
          ? [{ id: 1 }, { id: 2 }]
          : [{ id: 3 }],
    );
    mockFindViewsByRuntimeIdentity.mockImplementation(
      async (runtimeIdentity) =>
        runtimeIdentity.knowledgeBaseId === 'kb-newer' ? [{ id: 10 }] : [],
    );
    mockGetPrimaryConnector.mockImplementation(async (knowledgeBase: any) => {
      if (knowledgeBase.id === 'kb-older') {
        return {
          id: 'connector-older',
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-older',
          type: 'database',
          databaseProvider: 'postgres',
          trinoCatalogName: 'kb_kb1_conolder',
          displayName: 'Warehouse',
          secretRecordId: 'secret-1',
        };
      }
      return null;
    });

    await handler(req, res);

    expect(mockListKnowledgeBases).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({
        actor: expect.objectContaining({
          principalId: 'user-1',
          workspaceId: 'ws-1',
        }),
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'GET_KNOWLEDGE_BASES',
      }),
    );

    const responsePayload =
      mockRespondWithSimple.mock.calls[0][0].responsePayload;
    expect(responsePayload.map((item: any) => item.id)).toEqual([
      'kb-newer',
      'kb-older',
    ]);
    expect(responsePayload[0]).toEqual(
      expect.objectContaining({
        id: 'kb-newer',
        language: 'zh-TW',
        snapshotCount: 2,
        assetCount: 3,
        runtimeProjectId: null,
        defaultKbSnapshot: expect.objectContaining({
          id: 'snap-newer',
          snapshotKey: 'snapshot-newer',
        }),
        primaryConnector: null,
      }),
    );
    expect(responsePayload[1]).toEqual(
      expect.objectContaining({
        id: 'kb-older',
        sampleDataset: 'ecommerce',
        assetCount: 1,
        primaryConnectorId: 'connector-older',
        runtimeProjectId: 701,
        primaryConnector: expect.objectContaining({
          id: 'connector-older',
          type: 'database',
          databaseProvider: 'postgres',
          trinoCatalogName: 'kb_kb1_conolder',
          hasSecret: true,
        }),
      }),
    );
  });

  it('creates a knowledge base through the service layer', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/bases'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        name: '  Revenue Hub  ',
        description: '  Revenue metrics and reports  ',
        slug: 'revenue-hub',
      },
    });
    const res = createRes();

    mockCreateKnowledgeBase.mockResolvedValue({
      id: 'kb-created',
      workspaceId: 'ws-1',
      slug: 'revenue-hub',
      name: 'Revenue Hub',
      kind: 'regular',
      description: 'Revenue metrics and reports',
      defaultKbSnapshotId: null,
      primaryConnectorId: null,
      runtimeProjectId: null,
      language: null,
      sampleDataset: null,
      createdBy: 'user-1',
      archivedAt: null,
    });

    await handler(req, res);

    expect(mockCreateKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        name: 'Revenue Hub',
        description: 'Revenue metrics and reports',
        slug: 'revenue-hub',
        createdBy: 'user-1',
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 201,
        apiType: 'CREATE_KNOWLEDGE_BASE',
        responsePayload: expect.objectContaining({
          id: 'kb-created',
          primaryConnectorId: null,
          runtimeProjectId: null,
          sampleDataset: null,
        }),
      }),
    );
  });

  it('returns 403 for knowledge base creation in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const handler = (await import('../../pages/api/v1/knowledge/bases'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        name: 'Revenue Hub',
        description: 'Revenue metrics and reports',
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      ...runtimeScope,
      actorClaims: {
        ...runtimeScope.actorClaims,
        permissionScopes: ['workspace:*'],
        grantedActions: [],
        workspaceRoleSource: 'legacy',
        platformRoleSource: 'legacy',
      },
    });

    await handler(req, res);

    expect(mockCreateKnowledgeBase).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: expect.stringMatching(/permission required/i),
    });
  });

  it('gets a knowledge base by id with default snapshot and primary connector', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/bases/[id]'))
      .default;
    const req = createReq({
      method: 'GET',
      query: { id: 'kb-42' },
    });
    const res = createRes();

    mockGetKnowledgeBaseById.mockResolvedValue({
      id: 'kb-42',
      workspaceId: 'ws-1',
      slug: 'sales',
      name: 'Sales KB',
      kind: 'regular',
      description: 'Sales knowledge base',
      defaultKbSnapshotId: 'snap-42',
      primaryConnectorId: 'connector-42',
      runtimeProjectId: 842,
      language: 'en',
      sampleDataset: 'sales',
      archivedAt: null,
    });
    mockFindKbSnapshot.mockResolvedValue({
      id: 'snap-42',
      snapshotKey: 'snapshot-42',
      displayName: 'Snapshot 42',
      deployHash: 'deploy-42',
      status: 'ready',
    });
    mockFindAllKbSnapshots.mockResolvedValue([{ id: 'snap-42' }]);
    mockGetPrimaryConnector.mockResolvedValue({
      id: 'connector-42',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-42',
      type: 'database',
      databaseProvider: 'postgres',
      trinoCatalogName: 'kb_sales_connector42',
      displayName: 'Sales Warehouse',
      secretRecordId: null,
    });

    await handler(req, res);

    expect(mockGetKnowledgeBaseById).toHaveBeenCalledWith(
      'ws-1',
      'kb-42',
      expect.objectContaining({
        actor: expect.objectContaining({
          principalId: 'user-1',
        }),
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'GET_KNOWLEDGE_BASES',
        responsePayload: expect.objectContaining({
          id: 'kb-42',
          runtimeProjectId: 842,
          defaultKbSnapshot: expect.objectContaining({
            id: 'snap-42',
            snapshotKey: 'snapshot-42',
          }),
          primaryConnector: expect.objectContaining({
            id: 'connector-42',
            databaseProvider: 'postgres',
            trinoCatalogName: 'kb_sales_connector42',
            displayName: 'Sales Warehouse',
            hasSecret: false,
          }),
        }),
      }),
    );
  });

  it('patches knowledge base runtime settings through the service layer', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/bases/[id]'))
      .default;
    const req = createReq({
      method: 'PATCH',
      query: { id: 'kb-88' },
      body: {
        name: '  Updated KB  ',
        description: '  Updated description  ',
        defaultKbSnapshotId: 'snap-88',
        primaryConnectorId: 'connector-88',
        language: 'zh-CN',
        sampleDataset: 'orders',
      },
    });
    const res = createRes();

    mockGetKnowledgeBaseById.mockResolvedValue({
      id: 'kb-88',
      workspaceId: 'ws-1',
      slug: 'updated-kb',
      name: 'Old KB',
      kind: 'regular',
      archivedAt: null,
    });
    mockUpdateKnowledgeBase.mockResolvedValue({
      id: 'kb-88',
      workspaceId: 'ws-1',
      slug: 'updated-kb',
      name: 'Updated KB',
      kind: 'regular',
      description: 'Updated description',
      defaultKbSnapshotId: 'snap-88',
      primaryConnectorId: 'connector-88',
      runtimeProjectId: 988,
      language: 'zh-CN',
      sampleDataset: 'orders',
      archivedAt: null,
    });
    mockFindKbSnapshot.mockResolvedValue({
      id: 'snap-88',
      snapshotKey: 'snapshot-88',
      displayName: 'Snapshot 88',
      deployHash: 'deploy-88',
      status: 'ready',
    });
    mockFindAllKbSnapshots.mockResolvedValue([{ id: 'snap-88' }]);
    mockGetPrimaryConnector.mockResolvedValue({
      id: 'connector-88',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-88',
      type: 'database',
      databaseProvider: 'mysql',
      trinoCatalogName: 'kb_orders_connector88',
      displayName: 'Orders Warehouse',
      secretRecordId: 'secret-88',
    });

    await handler(req, res);

    expect(mockUpdateKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-88',
        workspaceId: 'ws-1',
        name: 'Updated KB',
        description: 'Updated description',
        defaultKbSnapshotId: 'snap-88',
        primaryConnectorId: 'connector-88',
        language: 'zh-CN',
        sampleDataset: 'orders',
        archivedAt: undefined,
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'UPDATE_KNOWLEDGE_BASE',
        responsePayload: expect.objectContaining({
          id: 'kb-88',
          runtimeProjectId: 988,
          language: 'zh-CN',
          sampleDataset: 'orders',
          primaryConnector: expect.objectContaining({
            id: 'connector-88',
            databaseProvider: 'mysql',
            trinoCatalogName: 'kb_orders_connector88',
            hasSecret: true,
          }),
        }),
      }),
    );
  });

  it('rejects patch requests with an empty knowledge base name', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/bases/[id]'))
      .default;
    const req = createReq({
      method: 'PATCH',
      query: { id: 'kb-11' },
      body: {
        name: '   ',
      },
    });
    const res = createRes();

    mockGetKnowledgeBaseById.mockResolvedValue({
      id: 'kb-11',
      workspaceId: 'ws-1',
      slug: 'demo',
      name: 'Demo',
      kind: 'regular',
      archivedAt: null,
    });

    await handler(req, res);

    expect(mockUpdateKnowledgeBase).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'Knowledge base name cannot be empty',
    });
  });

  it('rejects creating a knowledge base from member-only permissions', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/bases'))
      .default;
    const req = createReq({
      method: 'POST',
      body: { name: 'Member KB' },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      ...runtimeScope,
      actorClaims: { roleKeys: ['member'] },
    });

    await handler(req, res);

    expect(mockCreateKnowledgeBase).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'Knowledge base write permission required',
    });
  });

  it('rejects updating a system sample knowledge base', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/bases/[id]'))
      .default;
    const req = createReq({
      method: 'PATCH',
      query: { id: 'kb-system' },
      body: { name: 'Nope' },
    });
    const res = createRes();

    mockGetKnowledgeBaseById.mockResolvedValue({
      id: 'kb-system',
      workspaceId: 'ws-1',
      slug: 'hr',
      name: 'HR',
      kind: 'system_sample',
      archivedAt: null,
    });

    await handler(req, res);

    expect(mockUpdateKnowledgeBase).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'System sample knowledge base cannot be modified',
    });
  });
});

export {};
