const mockResolveRequestScope = jest.fn();
const mockListInstructions = jest.fn();
const mockCreateInstruction = jest.fn();
const mockGetInstruction = jest.fn();
const mockUpdateInstruction = jest.fn();
const mockDeleteInstruction = jest.fn();
const mockRespondWithSimple = jest.fn();
const mockAssertLatestExecutableRuntimeScope = jest.fn();
const mockCreateAuditEvent = jest.fn();
const mockAssertAuthorizedWithAudit = jest.fn();
const mockBuildAuthorizationActorFromRuntimeScope = jest.fn();
const mockBuildAuthorizationContextFromRequest = jest.fn();
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
    instructionService: {
      listInstructions: mockListInstructions,
      createInstruction: mockCreateInstruction,
      getInstruction: mockGetInstruction,
      updateInstruction: mockUpdateInstruction,
      deleteInstruction: mockDeleteInstruction,
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

describe('pages/api/v1/knowledge/instructions/[id]', () => {
  const runtimeScope = {
    project: { id: 1 },
    workspace: { id: 'ws_1', kind: 'regular' },
    knowledgeBase: { id: 'kb_1', kind: 'regular' },
    kbSnapshot: { id: 'snapshot_1' },
    deployHash: 'deploy_hash_1',
    userId: 'user_1',
  };
  const authActor = { type: 'user', sessionId: 'session-1' };
  const authContext = { requestId: 'request-1' };
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'PUT',
      query: { id: '7' },
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertLatestExecutableRuntimeScope.mockResolvedValue(undefined);
    mockResolveRequestScope.mockResolvedValue(runtimeScope);
    mockBuildAuthorizationActorFromRuntimeScope.mockReturnValue(authActor);
    mockBuildAuthorizationContextFromRequest.mockReturnValue(authContext);
    mockAssertAuthorizedWithAudit.mockResolvedValue(undefined);
  });

  it('authorizes knowledge base read before listing instructions', async () => {
    const handler = (await import('../v1/knowledge/instructions')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockListInstructions.mockResolvedValue([
      { id: 1, instruction: 'Use paid orders', questions: [], isDefault: true },
    ]);

    await handler(req, res);

    expect(mockAssertAuthorizedWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: authActor,
        action: 'knowledge_base.read',
        resource: expect.objectContaining({
          resourceType: 'knowledge_base',
          resourceId: 'kb_1',
          workspaceId: 'ws_1',
        }),
        context: authContext,
      }),
    );
    expect(mockListInstructions).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_1',
        knowledgeBaseId: 'kb_1',
      }),
    );
  });

  it('audits instruction creation as knowledge base update', async () => {
    const handler = (await import('../v1/knowledge/instructions')).default;
    const req = createReq({
      method: 'POST',
      body: {
        instruction: 'Only use paid orders',
        questions: ['How many paid orders?'],
      },
    });
    const res = createRes();

    mockCreateInstruction.mockResolvedValue({
      id: 11,
      instruction: 'Only use paid orders',
      questions: ['How many paid orders?'],
      isDefault: false,
    });

    await handler(req, res);

    expect(mockAssertAuthorizedWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        resource: expect.objectContaining({
          resourceType: 'knowledge_base',
          resourceId: 'kb_1',
          workspaceId: 'ws_1',
          attributes: expect.objectContaining({
            knowledgeBaseKind: 'regular',
          }),
        }),
      }),
    );
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'succeeded',
        payloadJson: { operation: 'instruction.create' },
      }),
    );
  });

  it('returns 404 when the scoped instruction lookup misses the current runtime identity', async () => {
    const handler = (await import('../v1/knowledge/instructions/[id]')).default;
    const req = createReq();
    const res = createRes();

    mockAssertLatestExecutableRuntimeScope.mockResolvedValue(undefined);
    mockGetInstruction.mockResolvedValue(null);

    await handler(req, res);

    expect(mockGetInstruction).toHaveBeenCalledWith(
      {
        projectId: null,
        workspaceId: 'ws_1',
        knowledgeBaseId: 'kb_1',
        kbSnapshotId: 'snapshot_1',
        deployHash: 'deploy_hash_1',
        actorUserId: 'user_1',
      },
      7,
    );
    expect(mockUpdateInstruction).not.toHaveBeenCalled();
    expect(mockRespondWithSimple).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Instruction not found' });
  });

  it('returns 409 on outdated snapshot before deleting instructions', async () => {
    const handler = (await import('../v1/knowledge/instructions/[id]')).default;
    const req = createReq({ method: 'DELETE' });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      ...runtimeScope,
      kbSnapshot: { id: 'snapshot_old' },
      deployHash: 'deploy_old',
    });
    mockAssertLatestExecutableRuntimeScope.mockRejectedValue(
      new Error('This snapshot is outdated and cannot be executed'),
    );

    await handler(req, res);

    expect(mockDeleteInstruction).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: 'This snapshot is outdated and cannot be executed',
    });
  });

  it('audits instruction deletion as knowledge base update', async () => {
    const handler = (await import('../v1/knowledge/instructions/[id]')).default;
    const req = createReq({ method: 'DELETE' });
    const res = createRes();

    mockGetInstruction.mockResolvedValue({
      id: 7,
      instruction: 'Legacy rule',
      questions: ['Q1'],
      isDefault: false,
    });

    await handler(req, res);

    expect(mockAssertAuthorizedWithAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'knowledge_base.read',
      }),
    );
    expect(mockAssertAuthorizedWithAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'knowledge_base.update',
      }),
    );
    expect(mockDeleteInstruction).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        knowledgeBaseId: 'kb_1',
      }),
    );
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'succeeded',
        payloadJson: {
          operation: 'instruction.delete',
          instructionId: 7,
        },
      }),
    );
  });
});

export {};
