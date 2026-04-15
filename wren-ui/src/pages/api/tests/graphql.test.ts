export {};

import { GraphQLError } from 'graphql';

const mockResolveRequestScope = jest.fn();
const mockResolveRequestActor = jest.fn();
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
  auditEventRepository: { createOne: jest.fn() },
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
  authService: {
    validateSession: jest.fn().mockResolvedValue({
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
      },
      user: { id: 'user-1', isPlatformAdmin: false },
      workspace: { id: 'workspace-1' },
      membership: { id: 'member-1', roleKey: 'owner' },
      session: { id: 'session-1' },
    }),
  },
  workspaceService: {},
  automationService: {
    validateApiToken: jest.fn().mockResolvedValue(null),
  },
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
    NO_DEPLOYMENT_FOUND: 'NO_DEPLOYMENT_FOUND',
    OUTDATED_RUNTIME_SNAPSHOT: 'OUTDATED_RUNTIME_SNAPSHOT',
  },
  create: (code: string, options?: { customMessage?: string }) =>
    new GraphQLError(options?.customMessage || code, {
      extensions: { code, message: options?.customMessage || code },
    }),
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

jest.mock('@server/context', () => ({
  resolveRequestActor: (...args: any[]) => mockResolveRequestActor(...args),
}));

describe('pages/api/graphql bootstrap context', () => {
  beforeAll(async () => {
    await import('../graphql');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockApolloStart.mockResolvedValue(undefined);
    mockApolloCreateHandler.mockReturnValue(jest.fn());
    mockResolveRequestActor.mockResolvedValue({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      authorizationActor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        workspaceRoleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
        isPlatformAdmin: false,
        platformRoleKeys: [],
        grantedActions: ['workspace.read'],
      },
    });
  });

  it('treats missing runtime selector as a recoverable bootstrap error for RuntimeSelectorState', async () => {
    mockResolveRequestScope.mockRejectedValueOnce(
      new Error('Runtime scope selector is required for this request'),
    );

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: {},
        body: { operationName: 'RuntimeSelectorState' },
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith({
      headers: {},
      body: { operationName: 'RuntimeSelectorState' },
    });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Runtime scope unavailable during bootstrap flow: Runtime scope selector is required for this request',
    );
    expect(ctx.runtimeScope).toBeNull();
    expect(ctx.runtimeScopeResolver).toBe(mockComponents.runtimeScopeResolver);
    expect(ctx.knowledgeBaseRepository).toBe(
      mockComponents.knowledgeBaseRepository,
    );
    expect(ctx.kbSnapshotRepository).toBe(mockComponents.kbSnapshotRepository);
  });

  it('recovers invalid runtime selectors for RuntimeSelectorState without surfacing a 500', async () => {
    mockResolveRequestScope.mockRejectedValueOnce(
      new Error('No deployment found for the requested runtime scope'),
    );

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: {},
        body: { operationName: 'RuntimeSelectorState' },
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith({
      headers: {},
      body: { operationName: 'RuntimeSelectorState' },
    });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Runtime scope unavailable during bootstrap flow: No deployment found for the requested runtime scope',
    );
    expect(ctx.runtimeScope).toBeNull();
  });

  it('recovers invalid runtime selectors for bootstrap requests even when operationName is unreadable', async () => {
    mockResolveRequestScope.mockRejectedValueOnce(
      new Error('No deployment found for the requested runtime scope'),
    );

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: {
          'content-type': 'application/json',
          'x-wren-runtime-bootstrap': '1',
        },
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith({
      headers: {
        'content-type': 'application/json',
        'x-wren-runtime-bootstrap': '1',
      },
    });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Runtime scope unavailable during bootstrap flow: No deployment found for the requested runtime scope',
    );
    expect(ctx.runtimeScope).toBeNull();
  });

  it('recovers bootstrap requests when operationName is only present in a raw JSON body', async () => {
    mockResolveRequestScope.mockRejectedValueOnce(
      new Error('Runtime scope selector is required for this request'),
    );

    const rawBody = JSON.stringify({
      operationName: 'OnboardingStatus',
      variables: {},
      query: 'query OnboardingStatus { onboardingStatus { status } }',
    });

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: { 'content-type': 'application/json' },
        body: rawBody,
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith({
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Runtime scope unavailable during bootstrap flow: Runtime scope selector is required for this request',
    );
    expect(ctx.runtimeScope).toBeNull();
  });

  it('recovers missing-selector requests even when operationName is unreadable at context time', async () => {
    mockResolveRequestScope.mockRejectedValueOnce(
      new Error('Runtime scope selector is required for this request'),
    );

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: { 'content-type': 'application/json' },
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith({
      headers: { 'content-type': 'application/json' },
    });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Runtime scope unavailable during bootstrap flow: Runtime scope selector is required for this request',
    );
    expect(ctx.runtimeScope).toBeNull();
  });

  it('does not use the legacy project shim for startSampleDataset bootstrap', async () => {
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

    expect(mockResolveRequestScope).toHaveBeenCalledWith({
      headers: { authorization: 'Bearer token' },
      body: { operationName: 'StartSampleDataset' },
    });
    expect(ctx.runtimeScope).toBe(runtimeScope);
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('does not use the legacy project shim for saveDataSource bootstrap', async () => {
    mockResolveRequestScope.mockResolvedValueOnce({ project: { id: 24 } });

    await capturedApolloConfig.context({
      req: {
        headers: {},
        body: { operationName: 'SaveDataSource' },
      },
    });

    expect(mockResolveRequestScope).toHaveBeenCalledWith({
      headers: {},
      body: { operationName: 'SaveDataSource' },
    });
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

    expect(mockResolveRequestScope).toHaveBeenCalledWith({
      headers: {},
      body: { operationName: 'OnboardingStatus' },
    });
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

    expect(mockResolveRequestScope).toHaveBeenCalledWith({
      headers: {},
      body: { operationName: 'GetSettings' },
    });
  });

  it('injects requestActor and authorizationActor into Apollo context', async () => {
    const runtimeScope = {
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
    };
    mockResolveRequestScope.mockResolvedValueOnce(runtimeScope);

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: { authorization: 'Bearer token' },
        body: { operationName: 'RuntimeSelectorState' },
      },
    });

    expect(mockResolveRequestActor).toHaveBeenCalledWith({
      req: {
        headers: { authorization: 'Bearer token' },
        body: { operationName: 'RuntimeSelectorState' },
      },
      authService: mockComponents.authService,
      automationService: mockComponents.automationService,
      workspaceId: 'workspace-1',
    });
    expect(ctx.requestActor).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    );
    expect(ctx.authorizationActor).toEqual(
      expect.objectContaining({
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    );
  });

  it('degrades to null request actor when request actor resolution fails', async () => {
    mockResolveRequestScope.mockResolvedValueOnce({
      workspace: { id: 'workspace-1' },
    });
    mockResolveRequestActor.mockRejectedValueOnce(
      new Error('Invalid or expired session'),
    );

    const ctx = await capturedApolloConfig.context({
      req: {
        headers: { authorization: 'Bearer bad-token' },
        body: { operationName: 'RuntimeSelectorState' },
      },
    });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Request actor unavailable: Invalid or expired session',
    );
    expect(ctx.requestActor).toBeNull();
    expect(ctx.authorizationActor).toBeNull();
  });

  it('rethrows non-recoverable runtime scope errors', async () => {
    mockResolveRequestScope.mockRejectedValueOnce(
      new Error('session mismatch'),
    );

    await expect(
      capturedApolloConfig.context({
        req: {
          headers: {},
          body: { operationName: 'RuntimeSelectorState' },
        },
      }),
    ).rejects.toThrow('session mismatch');
  });

  it('maps missing deployment context failures to a targeted graphql error', async () => {
    const result = capturedApolloConfig.formatError(
      new GraphQLError(
        'Context creation failed: No deployment found for the requested runtime scope',
      ),
    );

    expect(result.message).toBe(
      'Current knowledge base runtime is unavailable. Refresh or reselect a knowledge base and try again.',
    );
    expect(result.extensions.code).toBe('NO_DEPLOYMENT_FOUND');
  });

  it('maps outdated runtime snapshot context failures to a targeted graphql error', async () => {
    const result = capturedApolloConfig.formatError(
      new GraphQLError(
        'Context creation failed: deploy_hash does not match the requested kb_snapshot',
      ),
    );

    expect(result.message).toBe(
      'Current knowledge base snapshot is outdated. Refresh or reselect a knowledge base and try again.',
    );
    expect(result.extensions.code).toBe('OUTDATED_RUNTIME_SNAPSHOT');
  });
});
