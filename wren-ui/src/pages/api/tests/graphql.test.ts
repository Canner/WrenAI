const mockResolveRequestScope = jest.fn();
const mockLogger = {
  level: 'debug',
  error: jest.fn(),
  debug: jest.fn(),
};
const mockApolloStart = jest.fn().mockResolvedValue(undefined);
const mockApolloCreateHandler = jest.fn().mockReturnValue(jest.fn());

let capturedApolloConfig: any;

const mockComponents = {
  telemetry: { sendEvent: jest.fn() },
  projectRepository: {},
  modelRepository: {},
  modelColumnRepository: {},
  relationRepository: {},
  deployLogRepository: {},
  viewRepository: {},
  schemaChangeRepository: {},
  learningRepository: {},
  modelNestedColumnRepository: {},
  dashboardRepository: {},
  dashboardItemRepository: {},
  sqlPairRepository: {},
  instructionRepository: {},
  apiHistoryRepository: {},
  dashboardItemRefreshJobRepository: {},
  workspaceRepository: {},
  knowledgeBaseRepository: {},
  kbSnapshotRepository: {},
  connectorRepository: {},
  secretRepository: {},
  skillDefinitionRepository: {},
  skillBindingRepository: {},
  userRepository: {},
  authIdentityRepository: {},
  authSessionRepository: {},
  workspaceMemberRepository: {},
  wrenEngineAdaptor: {},
  ibisAdaptor: {},
  wrenAIAdaptor: {},
  projectService: {},
  queryService: {},
  askingService: { initialize: jest.fn().mockResolvedValue(undefined) },
  deployService: {},
  mdlService: {},
  dashboardService: {},
  sqlPairService: {},
  instructionService: {},
  authService: {},
  workspaceService: {},
  secretService: {},
  connectorService: {},
  skillService: {},
  runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
  projectRecommendQuestionBackgroundTracker: {
    initialize: jest.fn().mockResolvedValue(undefined),
  },
  threadRecommendQuestionBackgroundTracker: {
    initialize: jest.fn().mockResolvedValue(undefined),
  },
  dashboardCacheBackgroundTracker: {},
};

jest.mock('micro-cors', () => ({
  __esModule: true,
  default: () => (handler: any) => handler,
}));

jest.mock('apollo-server-micro', () => ({
  ApolloServer: jest.fn().mockImplementation((config: any) => {
    capturedApolloConfig = config;
    return {
      start: mockApolloStart,
      createHandler: mockApolloCreateHandler,
    };
  }),
}));

jest.mock(
  '@server',
  () => ({
    typeDefs: {},
  }),
  { virtual: true },
);

jest.mock('@server/resolvers', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('@server/utils', () => ({
  getLogger: () => mockLogger,
}));

jest.mock('@server/config', () => ({
  getConfig: () => ({ wrenProductVersion: 'test' }),
}));

jest.mock('@server/services/modelService', () => ({
  ModelService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@/apollo/server/utils/error', () => ({
  GeneralErrorCodes: {
    DRY_RUN_ERROR: 'DRY_RUN_ERROR',
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  },
  defaultApolloErrorHandler: (error: any) => error,
}));

jest.mock('@/apollo/server/telemetry/telemetry', () => ({
  TelemetryEvent: {
    GRAPHQL_ERROR: 'GRAPHQL_ERROR',
  },
}));

jest.mock('@/common', () => ({
  components: mockComponents,
}));

describe('pages/api/graphql bootstrap context', () => {
  beforeAll(async () => {
    await import('../graphql');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockApolloStart.mockResolvedValue(undefined);
    mockApolloCreateHandler.mockReturnValue(jest.fn());
  });

  it('treats "No project found" as a recoverable bootstrap error for allowed operations', async () => {
    mockResolveRequestScope.mockRejectedValueOnce(new Error('No project found'));

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: {},
        body: { operationName: 'RuntimeSelectorState' },
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith(
      {
        headers: {},
        body: { operationName: 'RuntimeSelectorState' },
      },
      { allowLegacyProjectShim: true },
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Runtime scope unavailable during bootstrap flow: No project found',
    );
    expect(ctx.runtimeScope).toBeNull();
    expect(ctx.runtimeScopeResolver).toBe(mockComponents.runtimeScopeResolver);
    expect(ctx.knowledgeBaseRepository).toBe(
      mockComponents.knowledgeBaseRepository,
    );
    expect(ctx.kbSnapshotRepository).toBe(mockComponents.kbSnapshotRepository);
  });

  it('preserves runtime scope when resolver succeeds for allowed operations', async () => {
    const runtimeScope = {
      project: { id: 42 },
      workspace: { id: 'workspace-1' },
    };
    mockResolveRequestScope.mockResolvedValueOnce(runtimeScope);

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: { authorization: 'Bearer token' },
        body: { operationName: 'StartSampleDataset' },
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith(
      {
        headers: { authorization: 'Bearer token' },
        body: { operationName: 'StartSampleDataset' },
      },
      { allowLegacyProjectShim: true },
    );
    expect(ctx.runtimeScope).toBe(runtimeScope);
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('allows onboarding bootstrap requests to continue with null runtime scope', async () => {
    mockResolveRequestScope.mockRejectedValueOnce(
      new Error('Runtime scope selector is required for this request'),
    );

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: {},
        body: { operationName: 'OnboardingStatus' },
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith(
      {
        headers: {},
        body: { operationName: 'OnboardingStatus' },
      },
      { allowLegacyProjectShim: false },
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Runtime scope unavailable during bootstrap flow: Runtime scope selector is required for this request',
    );
    expect(ctx.runtimeScope).toBeNull();
  });

  it('does not allow legacy project shim for non-bootstrap operations', async () => {
    mockResolveRequestScope.mockResolvedValueOnce({ project: { id: 7 } });

    await capturedApolloConfig.context({
      req: {
        headers: {},
        body: { operationName: 'GetSettings' },
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith(
      {
        headers: {},
        body: { operationName: 'GetSettings' },
      },
      { allowLegacyProjectShim: false },
    );
  });

  it('rethrows non-recoverable runtime scope errors', async () => {
    mockResolveRequestScope.mockRejectedValueOnce(new Error('session mismatch'));

    await expect(
      capturedApolloConfig.context({
        req: {
          headers: {},
          body: { operationName: 'RuntimeSelectorState' },
        },
      }),
    ).rejects.toThrow('session mismatch');
  });
});
