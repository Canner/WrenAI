import { safeFormatSQL } from '@server/utils/sqlFormat';
import { replaceAllowableSyntax } from '@server/utils/regex';
export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockAssertResponseScope = jest.fn();
const mockGetResponseScoped = jest.fn();
const mockValidateViewNameByRuntimeIdentity = jest.fn();
const mockGetViewByRuntimeIdentity = jest.fn();
const mockDescribeStatement = jest.fn();
const mockPreview = jest.fn();
const mockCreateView = jest.fn();
const mockDeleteView = jest.fn();
const mockRespondWithSimple = jest.fn();
const mockCreateAuditEvent = jest.fn();
const mockAssertAuthorizedWithAudit = jest.fn();
const mockBuildAuthorizationActorFromRuntimeScope = jest.fn();
const mockBuildAuthorizationContextFromRequest = jest.fn();
const mockRecordAuditEvent = jest.fn();
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
    askingService: {
      assertResponseScope: mockAssertResponseScope,
      getResponseScoped: mockGetResponseScoped,
    },
    modelService: {
      validateViewNameByRuntimeIdentity: mockValidateViewNameByRuntimeIdentity,
      getViewByRuntimeIdentity: mockGetViewByRuntimeIdentity,
    },
    queryService: {
      describeStatement: mockDescribeStatement,
      preview: mockPreview,
    },
    viewRepository: {
      createOne: mockCreateView,
      deleteOne: mockDeleteView,
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
  },
}));

jest.mock('@/server/utils/apiUtils', () => {
  const actual = jest.requireActual('@/server/utils/apiUtils');
  return {
    ...actual,
    ApiError: MockApiError,
    respondWithSimple: mockRespondWithSimple,
    handleApiError: mockHandleApiError,
  };
});

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

jest.mock('@server/authz', () => ({
  assertAuthorizedWithAudit: mockAssertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope:
    mockBuildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest:
    mockBuildAuthorizationContextFromRequest,
  recordAuditEvent: mockRecordAuditEvent,
}));

describe('pages/api/v1/views route', () => {
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    source: 'explicit-request',
    selector: { runtimeScopeId: 'scope-1' },
    project: { id: 21, language: 'ZH_TW' },
    deployment: {
      projectId: 21,
      hash: 'deploy-1',
      manifest: { schema: [] },
    },
    deployHash: 'deploy-1',
    workspace: { id: 'ws-1', kind: 'regular' },
    knowledgeBase: {
      id: 'kb-1',
      kind: 'regular',
      defaultKbSnapshotId: 'snap-1',
    },
    kbSnapshot: { id: 'snap-1', deployHash: 'deploy-1' },
    userId: 'user-1',
    actorClaims: {
      workspaceId: 'ws-1',
      workspaceMemberId: 'member-1',
      roleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      grantedActions: ['knowledge_base.update'],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    },
    ...overrides,
  });

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      body: {
        name: '销售视图',
        responseId: 101,
        rephrasedQuestion: '按地区查看 GMV 趋势',
      },
      headers: {},
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
    return res;
  };

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockAssertAuthorizedWithAudit.mockResolvedValue(undefined);
    mockBuildAuthorizationActorFromRuntimeScope.mockImplementation(
      (runtimeScope: any) => ({
        userId: runtimeScope?.userId || 'user-1',
        sessionId: 'session-1',
      }),
    );
    mockBuildAuthorizationContextFromRequest.mockImplementation(
      ({ runtimeScope }: any) => ({
        workspaceId: runtimeScope?.workspace?.id || null,
      }),
    );
    mockValidateViewNameByRuntimeIdentity.mockResolvedValue({ valid: true });
    mockGetResponseScoped.mockResolvedValue({
      id: 101,
      sql: 'select total from sales',
    });
    mockDescribeStatement.mockResolvedValue({
      columns: [{ name: 'total', type: 'number' }],
    });
    mockPreview.mockResolvedValue({
      columns: [{ name: 'total', type: 'number' }],
      data: [[100]],
    });
    mockCreateView.mockResolvedValue({
      id: 8,
      name: 'sales_view',
      statement: 'select total from sales',
    });
    mockGetViewByRuntimeIdentity.mockResolvedValue({
      id: 8,
      name: 'sales_view',
      statement: 'select total from sales',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('creates a runtime-scoped view from a thread response', async () => {
    const handler = (await import('../../pages/api/v1/views/index')).default;
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(mockAssertResponseScope).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      }),
    );
    expect(mockValidateViewNameByRuntimeIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
      '销售视图',
    );
    expect(mockDescribeStatement).toHaveBeenCalledWith(
      safeFormatSQL('select total from sales'),
      expect.objectContaining({
        project: expect.objectContaining({ id: 21 }),
        modelingOnly: false,
      }),
    );
    expect(mockCreateView).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        name: replaceAllowableSyntax('销售视图'),
        statement: safeFormatSQL('select total from sales'),
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 201,
        apiType: 'CREATE_VIEW',
        responsePayload: expect.objectContaining({
          id: 8,
          displayName: '销售视图',
        }),
      }),
    );
  });

  it('returns 400 when responseId is invalid', async () => {
    const handler = (await import('../../pages/api/v1/views/index')).default;
    const req = createReq({ body: { name: '销售视图', responseId: 0 } });
    const res = createRes();

    await handler(req, res);

    expect(mockAssertResponseScope).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Response ID is invalid' });
  });

  it('validates a view name through the REST route', async () => {
    const handler = (await import('../../pages/api/v1/views/validate')).default;
    const req = createReq({ body: { name: '销售视图' } });
    const res = createRes();
    mockValidateViewNameByRuntimeIdentity.mockResolvedValue({
      valid: true,
    });

    await handler(req, res);

    expect(mockValidateViewNameByRuntimeIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
      '销售视图',
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ valid: true });
  });

  it('returns 400 when the view validation request is missing a name', async () => {
    const handler = (await import('../../pages/api/v1/views/validate')).default;
    const req = createReq({ body: { name: '   ' } });
    const res = createRes();

    await handler(req, res);

    expect(mockValidateViewNameByRuntimeIdentity).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: '视图名称不能为空' });
  });

  it('deletes a runtime-scoped view through the REST route', async () => {
    const handler = (await import('../../pages/api/v1/views/[id]')).default;
    const req = createReq({
      method: 'DELETE',
      query: { id: '8' },
      body: {},
    });
    const res = createRes();

    await handler(req, res);

    expect(mockGetViewByRuntimeIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      }),
      8,
    );
    expect(mockDeleteView).toHaveBeenCalledWith(8);
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'DELETE_VIEW',
        responsePayload: { success: true },
      }),
    );
  });

  it('returns preview data for a runtime-scoped view through the REST route', async () => {
    const handler = (await import('../../pages/api/v1/views/[id]/preview'))
      .default;
    const req = createReq({
      method: 'GET',
      query: { id: '8', limit: '50' },
      body: {},
    });
    const res = createRes();

    await handler(req, res);

    expect(mockGetViewByRuntimeIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      }),
      8,
    );
    expect(mockPreview).toHaveBeenCalledWith(
      'select total from sales',
      expect.objectContaining({
        project: expect.objectContaining({ id: 21 }),
        manifest: { schema: [] },
        modelingOnly: false,
        limit: 50,
      }),
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        apiType: 'PREVIEW_VIEW_DATA',
        responsePayload: {
          columns: [{ name: 'total', type: 'number' }],
          data: [[100]],
        },
      }),
    );
  });
});
