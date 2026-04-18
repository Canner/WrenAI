const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScope = jest.fn();
const mockListSkillDefinitionsByWorkspace = jest.fn();
const mockListAvailableSkills = jest.fn();
const mockListMarketplaceCatalogSkills = jest.fn();
const mockCreateSkillDefinition = jest.fn();
const mockGetSkillDefinitionById = jest.fn();
const mockGetResolvedSkillDefinition = jest.fn();
const mockUpdateSkillDefinition = jest.fn();
const mockUpdateSkillDefinitionRuntime = jest.fn();
const mockDeleteSkillDefinition = jest.fn();
const mockInstallSkillFromMarketplace = jest.fn();
const mockGetResolvedConnector = jest.fn();
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
    skillService: {
      listSkillDefinitionsByWorkspace: mockListSkillDefinitionsByWorkspace,
      listAvailableSkills: mockListAvailableSkills,
      listMarketplaceCatalogSkills: mockListMarketplaceCatalogSkills,
      createSkillDefinition: mockCreateSkillDefinition,
      getSkillDefinitionById: mockGetSkillDefinitionById,
      getResolvedSkillDefinition: mockGetResolvedSkillDefinition,
      updateSkillDefinition: mockUpdateSkillDefinition,
      updateSkillDefinitionRuntime: mockUpdateSkillDefinitionRuntime,
      deleteSkillDefinition: mockDeleteSkillDefinition,
      installSkillFromMarketplace: mockInstallSkillFromMarketplace,
    },
    connectorService: {
      getResolvedConnector: mockGetResolvedConnector,
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

jest.mock('@server/authz', () => ({
  assertAuthorizedWithAudit: (...args: any[]) =>
    mockAssertAuthorizedWithAudit(...args),
  buildAuthorizationActorFromRuntimeScope: (...args: any[]) =>
    mockBuildAuthorizationActorFromRuntimeScope(...args),
  buildAuthorizationContextFromRequest: (...args: any[]) =>
    mockBuildAuthorizationContextFromRequest(...args),
  recordAuditEvent: (...args: any[]) => mockRecordAuditEvent(...args),
}));

describe('pages/api/v1/skills routes', () => {
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    project: { id: 9 },
    workspace: { id: 'workspace-1', kind: 'regular' },
    knowledgeBase: { id: 'kb-1', kind: 'regular' },
    userId: 'user-1',
    actorClaims: {
      workspaceId: 'workspace-1',
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
    mockBuildAuthorizationActorFromRuntimeScope.mockImplementation(
      (runtimeScope: any) => ({
        sessionId: 'session-1',
        workspaceId: runtimeScope?.workspace?.id,
      }),
    );
    mockBuildAuthorizationContextFromRequest.mockReturnValue({
      requestId: 'req-1',
    });
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('creates a workspace-scoped skill from runtime scope', async () => {
    const handler = (await import('../v1/skills')).default;
    const req = createReq({
      method: 'POST',
      body: {
        name: 'weather_skill',
        manifest: { version: '1.0.0' },
        secret: { apiKey: 'secret-token' },
        instruction: 'Only answer with weather summary',
        executionMode: 'inject_only',
        connectorId: 'connector-1',
        isEnabled: true,
        runtimeConfig: { timeoutSec: 30 },
        kbSuggestionIds: ['kb-1'],
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockCreateSkillDefinition.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      name: 'weather_skill',
      runtimeKind: 'isolated_python',
      sourceType: 'inline',
      instruction: 'Only answer with weather summary',
      connectorId: 'connector-1',
      isEnabled: true,
      runtimeConfigJson: { timeoutSec: 30 },
      kbSuggestionIds: ['kb-1'],
      manifestJson: { version: '1.0.0' },
      secretRecordId: 'secret-skill-1',
      createdBy: 'user-1',
    });

    await handler(req, res);

    expect(mockCreateSkillDefinition).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      name: 'weather_skill',
      runtimeKind: undefined,
      sourceType: undefined,
      sourceRef: undefined,
      entrypoint: undefined,
      manifest: { version: '1.0.0' },
      secret: { apiKey: 'secret-token' },
      instruction: 'Only answer with weather summary',
      executionMode: 'inject_only',
      connectorId: 'connector-1',
      isEnabled: true,
      runtimeConfig: { timeoutSec: 30 },
      kbSuggestionIds: ['kb-1'],
      createdBy: 'user-1',
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 201,
        runtimeScope: expect.objectContaining({
          project: { id: 9 },
        }),
        responsePayload: expect.objectContaining({
          id: 'skill-1',
          instruction: 'Only answer with weather summary',
          connectorId: 'connector-1',
          runtimeConfig: { timeoutSec: 30 },
          kbSuggestionIds: ['kb-1'],
          manifest: { version: '1.0.0' },
          hasSecret: true,
        }),
      }),
    );
  });

  it('returns 403 for skill creation in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const handler = (await import('../v1/skills')).default;
    const req = createReq({
      method: 'POST',
      body: {
        name: 'weather_skill',
        manifest: { version: '1.0.0' },
        secret: { apiKey: 'secret-token' },
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(
      buildRuntimeScope({
        actorClaims: {
          workspaceId: 'workspace-1',
          workspaceMemberId: 'member-1',
          roleKeys: ['owner'],
          permissionScopes: ['workspace:*'],
          grantedActions: [],
          workspaceRoleSource: 'legacy',
          platformRoleSource: 'legacy',
        },
      }),
    );
    mockAssertAuthorizedWithAudit.mockRejectedValueOnce(
      new MockApiError('permission required', 403),
    );

    await handler(req, res);

    expect(mockCreateSkillDefinition).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: expect.stringMatching(/permission required/i),
    });
  });

  it('lists available workspace runtime skills with runtime metadata', async () => {
    const handler = (await import('../v1/skills/available')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockListAvailableSkills.mockResolvedValue([
      {
        id: 'skill-1',
        workspaceId: 'workspace-1',
        name: 'sales_skill',
        runtimeKind: 'isolated_python',
        sourceType: 'inline',
        instruction: '仅统计已支付订单',
        executionMode: 'inject_only',
        connectorId: 'connector-1',
        kbSuggestionIds: ['kb-1'],
        manifestJson: { entry: 'main.py' },
      },
    ]);

    await handler(req, res);

    expect(mockListAvailableSkills).toHaveBeenCalledWith('workspace-1');
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        responsePayload: [
          expect.objectContaining({
            id: 'skill-1',
            instruction: '仅统计已支付订单',
            executionMode: 'inject_only',
            connectorId: 'connector-1',
            kbSuggestionIds: ['kb-1'],
            manifest: { entry: 'main.py' },
          }),
        ],
      }),
    );
  });

  it('rejects skill detail access when record belongs to another workspace', async () => {
    const handler = (await import('../v1/skills/[id]')).default;
    const req = createReq({
      method: 'GET',
      query: { id: 'skill-7' },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockGetSkillDefinitionById.mockResolvedValue({
      id: 'skill-7',
      workspaceId: 'workspace-2',
    });

    await handler(req, res);

    expect(mockGetSkillDefinitionById).toHaveBeenCalledWith('skill-7');
    expect(mockRespondWithSimple).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Skill not found' });
  });

  it('updates skill runtime fields through REST detail route', async () => {
    const handler = (await import('../v1/skills/[id]')).default;
    const req = createReq({
      method: 'PUT',
      query: { id: 'skill-9' },
      body: {
        name: 'weather_skill_v2',
        instruction: 'Always mention humidity',
        connectorId: 'connector-2',
        isEnabled: false,
        runtimeConfig: { timeoutSec: 10 },
        kbSuggestionIds: ['kb-2'],
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockGetSkillDefinitionById.mockResolvedValue({
      id: 'skill-9',
      workspaceId: 'workspace-1',
      name: 'weather_skill',
    });
    mockUpdateSkillDefinition.mockResolvedValue({
      id: 'skill-9',
      workspaceId: 'workspace-1',
      name: 'weather_skill_v2',
    });
    mockUpdateSkillDefinitionRuntime.mockResolvedValue({
      id: 'skill-9',
      workspaceId: 'workspace-1',
      name: 'weather_skill_v2',
      instruction: 'Always mention humidity',
      isEnabled: false,
      connectorId: 'connector-2',
      runtimeConfigJson: { timeoutSec: 10 },
      kbSuggestionIds: ['kb-2'],
    });

    await handler(req, res);

    expect(mockUpdateSkillDefinition).toHaveBeenCalledWith('skill-9', {
      name: 'weather_skill_v2',
      runtimeKind: undefined,
      sourceType: undefined,
      sourceRef: undefined,
      entrypoint: undefined,
      manifest: undefined,
      secret: undefined,
    });
    expect(mockUpdateSkillDefinitionRuntime).toHaveBeenCalledWith('skill-9', {
      instruction: 'Always mention humidity',
      connectorId: 'connector-2',
      isEnabled: false,
      runtimeConfig: { timeoutSec: 10 },
      kbSuggestionIds: ['kb-2'],
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        responsePayload: expect.objectContaining({
          id: 'skill-9',
          instruction: 'Always mention humidity',
          connectorId: 'connector-2',
          isEnabled: false,
          runtimeConfig: { timeoutSec: 10 },
          kbSuggestionIds: ['kb-2'],
        }),
      }),
    );
  });

  it('lists marketplace catalog skills through REST route', async () => {
    const handler = (await import('../v1/skills/marketplace')).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockListMarketplaceCatalogSkills.mockResolvedValue([
      {
        id: 'catalog-1',
        slug: 'sales-copilot',
        name: 'Sales Copilot',
        version: '1.0.0',
        runtimeKind: 'isolated_python',
        sourceType: 'marketplace',
        manifestJson: { timeoutMs: 1000 },
        defaultInstruction: 'Answer with sales metrics',
        isBuiltin: true,
        isFeatured: true,
        installCount: 12,
      },
    ]);

    await handler(req, res);

    expect(mockListMarketplaceCatalogSkills).toHaveBeenCalledTimes(1);
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        responsePayload: [
          expect.objectContaining({
            id: 'catalog-1',
            name: 'Sales Copilot',
            manifest: { timeoutMs: 1000 },
            defaultExecutionMode: 'inject_only',
            isBuiltin: true,
            isFeatured: true,
            installCount: 12,
          }),
        ],
      }),
    );
  });

  it('installs marketplace skills through REST route', async () => {
    const handler = (await import('../v1/skills/marketplace')).default;
    const req = createReq({
      method: 'POST',
      body: { catalogId: 'catalog-2' },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockInstallSkillFromMarketplace.mockResolvedValue({
      id: 'skill-20',
      workspaceId: 'workspace-1',
      name: 'Sales Copilot',
      runtimeKind: 'isolated_python',
      sourceType: 'marketplace',
      catalogId: 'catalog-2',
      installedFrom: 'marketplace',
    });

    await handler(req, res);

    expect(mockInstallSkillFromMarketplace).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      catalogId: 'catalog-2',
      userId: 'user-1',
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 201,
        responsePayload: expect.objectContaining({
          id: 'skill-20',
          catalogId: 'catalog-2',
          installedFrom: 'marketplace',
        }),
      }),
    );
  });
});

export {};
