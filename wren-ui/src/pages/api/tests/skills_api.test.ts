const mockResolveRequestScope = jest.fn();
const mockListSkillDefinitionsByWorkspace = jest.fn();
const mockCreateSkillDefinition = jest.fn();
const mockGetSkillDefinitionById = jest.fn();
const mockUpdateSkillDefinition = jest.fn();
const mockDeleteSkillDefinition = jest.fn();
const mockListSkillBindingsByKnowledgeBase = jest.fn();
const mockCreateSkillBinding = jest.fn();
const mockGetSkillBindingById = jest.fn();
const mockUpdateSkillBinding = jest.fn();
const mockDeleteSkillBinding = jest.fn();
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
    skillService: {
      listSkillDefinitionsByWorkspace: mockListSkillDefinitionsByWorkspace,
      createSkillDefinition: mockCreateSkillDefinition,
      getSkillDefinitionById: mockGetSkillDefinitionById,
      updateSkillDefinition: mockUpdateSkillDefinition,
      deleteSkillDefinition: mockDeleteSkillDefinition,
      listSkillBindingsByKnowledgeBase: mockListSkillBindingsByKnowledgeBase,
      createSkillBinding: mockCreateSkillBinding,
      getSkillBindingById: mockGetSkillBindingById,
      updateSkillBinding: mockUpdateSkillBinding,
      deleteSkillBinding: mockDeleteSkillBinding,
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

describe('pages/api/v1/skills routes', () => {
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

  it('creates a workspace-scoped skill from runtime scope', async () => {
    const handler = (await import('../v1/skills')).default;
    const req = createReq({
      method: 'POST',
      body: {
        name: 'weather_skill',
        manifest: { version: '1.0.0' },
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 9 },
      workspace: { id: 'workspace-1' },
      userId: 'user-1',
    });
    mockCreateSkillDefinition.mockResolvedValue({
      id: 'skill-1',
      workspaceId: 'workspace-1',
      name: 'weather_skill',
      runtimeKind: 'isolated_python',
      sourceType: 'inline',
      manifestJson: { version: '1.0.0' },
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
      createdBy: 'user-1',
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 201,
        projectId: 9,
        responsePayload: expect.objectContaining({
          id: 'skill-1',
          manifest: { version: '1.0.0' },
        }),
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

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 9 },
      workspace: { id: 'workspace-1' },
    });
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

  it('creates a knowledge-base-scoped skill binding from runtime scope', async () => {
    const handler = (await import('../v1/skills/bindings')).default;
    const req = createReq({
      method: 'POST',
      body: {
        skillDefinitionId: 'skill-1',
        connectorId: 'connector-1',
        bindingConfig: { timeoutSec: 20 },
      },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 11 },
      knowledgeBase: { id: 'kb-1' },
      userId: 'user-1',
    });
    mockCreateSkillBinding.mockResolvedValue({
      id: 'binding-1',
      knowledgeBaseId: 'kb-1',
      skillDefinitionId: 'skill-1',
      connectorId: 'connector-1',
      bindingConfig: { timeoutSec: 20 },
      enabled: true,
      createdBy: 'user-1',
    });

    await handler(req, res);

    expect(mockCreateSkillBinding).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: undefined,
      skillDefinitionId: 'skill-1',
      connectorId: 'connector-1',
      bindingConfig: { timeoutSec: 20 },
      enabled: undefined,
      createdBy: 'user-1',
    });
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 201,
        projectId: 11,
        responsePayload: expect.objectContaining({
          id: 'binding-1',
          knowledgeBaseId: 'kb-1',
        }),
      }),
    );
  });

  it('rejects skill binding mutation when runtime scope knowledge base mismatches', async () => {
    const handler = (await import('../v1/skills/bindings/[id]')).default;
    const req = createReq({
      method: 'PUT',
      query: { id: 'binding-7' },
      body: { enabled: false },
    });
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      project: { id: 11 },
      knowledgeBase: { id: 'kb-1' },
    });
    mockGetSkillBindingById.mockResolvedValue({
      id: 'binding-7',
      knowledgeBaseId: 'kb-2',
    });

    await handler(req, res);

    expect(mockUpdateSkillBinding).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Skill binding not found' });
  });
});

export {};
