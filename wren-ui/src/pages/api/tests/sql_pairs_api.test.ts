const mockResolveRequestScope = jest.fn();
const mockDeriveRuntimeExecutionContextFromRequest = jest.fn();
const mockValidateSql = jest.fn();
const mockCreateSqlPair = jest.fn();
const mockUpdateSqlPair = jest.fn();
const mockListSqlPairs = jest.fn();
const mockDeleteSqlPair = jest.fn();
const mockRespondWithSimple = jest.fn();
const mockCreateAuditEvent = jest.fn();
const mockAssertAuthorizedWithAudit = jest.fn();
const mockBuildAuthorizationActorFromRuntimeScope = jest.fn();
const mockBuildAuthorizationContextFromRequest = jest.fn();
const mockAssertLatestExecutableRuntimeScope = jest.fn();
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
    sqlPairService: {
      listSqlPairs: mockListSqlPairs,
      createSqlPair: mockCreateSqlPair,
      updateSqlPair: mockUpdateSqlPair,
      deleteSqlPair: mockDeleteSqlPair,
    },
    queryService: {},
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
    knowledgeBaseRepository: {},
    kbSnapshotRepository: {},
  },
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWithSimple: mockRespondWithSimple,
  handleApiError: mockHandleApiError,
  validateSql: mockValidateSql,
  deriveRuntimeExecutionContextFromRequest:
    mockDeriveRuntimeExecutionContextFromRequest,
}));

jest.mock('@/server/utils/runtimeExecutionContext', () => ({
  OUTDATED_RUNTIME_SNAPSHOT_MESSAGE:
    'This snapshot is outdated and cannot be executed',
  assertLatestExecutableRuntimeScope: (...args: any[]) =>
    mockAssertLatestExecutableRuntimeScope(...args),
}));

jest.mock('@server/authz', () => ({
  assertAuthorizedWithAudit: (...args: any[]) =>
    mockAssertAuthorizedWithAudit(...args),
  buildAuthorizationActorFromRuntimeScope: (...args: any[]) =>
    mockBuildAuthorizationActorFromRuntimeScope(...args),
  buildAuthorizationContextFromRequest: (...args: any[]) =>
    mockBuildAuthorizationContextFromRequest(...args),
  recordAuditEvent: ({ auditEventRepository, ...payload }: any) =>
    auditEventRepository.createOne(payload),
}));

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

describe('pages/api/v1/knowledge/sql_pairs routes', () => {
  const runtimeScope = {
    project: null,
    deployment: { projectId: 42, hash: 'deploy-1', manifest: { models: [] } },
    workspace: { id: 'workspace-1' },
    knowledgeBase: { id: 'kb-1' },
    kbSnapshot: { id: 'snapshot-1' },
    deployHash: 'deploy-1',
    userId: 'user-1',
  };
  const authActor = { type: 'user', sessionId: 'session-1' };
  const authContext = { requestId: 'request-1' };
  const executionContext = {
    project: { id: 42, language: 'EN' },
    deployment: runtimeScope.deployment,
    manifest: runtimeScope.deployment.manifest,
    language: 'English',
    runtimeIdentity: {
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    },
  };

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      query: {},
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(runtimeScope);
    mockDeriveRuntimeExecutionContextFromRequest.mockResolvedValue({
      runtimeScope,
      executionContext,
    });
    mockAssertLatestExecutableRuntimeScope.mockResolvedValue(undefined);
    mockBuildAuthorizationActorFromRuntimeScope.mockReturnValue(authActor);
    mockBuildAuthorizationContextFromRequest.mockReturnValue(authContext);
    mockAssertAuthorizedWithAudit.mockResolvedValue(undefined);
  });

  it('authorizes knowledge base read before listing sql pairs', async () => {
    const handler = (await import('../v1/knowledge/sql_pairs')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockListSqlPairs.mockResolvedValue([{ id: 1, sql: 'select 1' }]);

    await handler(req, res);

    expect(mockAssertAuthorizedWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: authActor,
        action: 'knowledge_base.read',
        resource: expect.objectContaining({
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          workspaceId: 'workspace-1',
        }),
        context: authContext,
      }),
    );
    expect(mockListSqlPairs).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
    );
  });

  it('creates sql pairs with derived runtime execution context when runtimeScope.project is absent', async () => {
    const handler = (await import('../v1/knowledge/sql_pairs')).default;
    const req = createReq({
      method: 'POST',
      body: {
        sql: 'select 1',
        question: 'What happened?',
      },
    });
    const res = createRes();
    mockCreateSqlPair.mockResolvedValue({ id: 9, sql: 'select 1' });

    await handler(req, res);

    expect(mockDeriveRuntimeExecutionContextFromRequest).toHaveBeenCalledWith({
      req,
      runtimeScopeResolver: expect.any(Object),
      noDeploymentMessage:
        'No deployment found, please deploy your project first',
      requireLatestExecutableSnapshot: true,
    });
    expect(mockValidateSql).toHaveBeenCalledWith(
      'select 1',
      executionContext,
      expect.any(Object),
    );
    expect(mockCreateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      {
        sql: 'select 1',
        question: 'What happened?',
      },
    );
    expect(mockAssertAuthorizedWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
      }),
    );
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'succeeded',
        payloadJson: {
          operation: 'sql_pair.create',
        },
      }),
    );
  });

  it('updates sql pairs with derived runtime execution context when runtimeScope.project is absent', async () => {
    const handler = (await import('../v1/knowledge/sql_pairs/[id]')).default;
    const req = createReq({
      method: 'PUT',
      query: { id: '7' },
      body: {
        sql: 'select 2',
        question: 'Updated question',
      },
    });
    const res = createRes();
    mockUpdateSqlPair.mockResolvedValue({ id: 7, sql: 'select 2' });

    await handler(req, res);

    expect(mockDeriveRuntimeExecutionContextFromRequest).toHaveBeenCalledWith({
      req,
      runtimeScopeResolver: expect.any(Object),
      noDeploymentMessage:
        'No deployment found, please deploy your project first',
      requireLatestExecutableSnapshot: true,
    });
    expect(mockValidateSql).toHaveBeenCalledWith(
      'select 2',
      executionContext,
      expect.any(Object),
    );
    expect(mockUpdateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      7,
      {
        sql: 'select 2',
        question: 'Updated question',
      },
    );
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'succeeded',
        payloadJson: {
          operation: 'sql_pair.update',
          sqlPairId: 7,
        },
      }),
    );
  });

  it('audits sql pair deletion as knowledge base update', async () => {
    const handler = (await import('../v1/knowledge/sql_pairs/[id]')).default;
    const req = createReq({
      method: 'DELETE',
      query: { id: '8' },
    });
    const res = createRes();

    await handler(req, res);

    expect(mockDeleteSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      8,
    );
    expect(mockAssertAuthorizedWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
      }),
    );
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'succeeded',
        payloadJson: {
          operation: 'sql_pair.delete',
          sqlPairId: 8,
        },
      }),
    );
  });
});

export {};
