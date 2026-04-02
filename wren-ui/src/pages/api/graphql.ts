import microCors from 'micro-cors';
import { NextApiRequest, NextApiResponse, PageConfig } from 'next';
import { ApolloServer } from 'apollo-server-micro';
import { typeDefs } from '@server';
import resolvers from '@server/resolvers';
import { IContext } from '@server/types';
import { GraphQLError } from 'graphql';
import { getLogger } from '@server/utils';
import { getConfig } from '@server/config';
import { ModelService } from '@server/services/modelService';
import {
  defaultApolloErrorHandler,
  GeneralErrorCodes,
} from '@/apollo/server/utils/error';
import { TelemetryEvent } from '@/apollo/server/telemetry/telemetry';
import { components } from '@/common';

const serverConfig = getConfig();
const logger = getLogger('APOLLO');
logger.level = 'debug';

const cors = microCors();

const LEGACY_RUNTIME_SCOPE_OPERATION_NAMES = new Set([
  'RuntimeSelectorState',
  'SaveDataSource',
  'StartSampleDataset',
]);

const RECOVERABLE_RUNTIME_SCOPE_ERRORS = new Set(['No project found']);

const NULL_RUNTIME_SCOPE_OPERATION_NAMES = new Set([
  'RuntimeSelectorState',
  'OnboardingStatus',
  'SaveDataSource',
  'StartSampleDataset',
]);

const readOperationName = (req: NextApiRequest): string | null => {
  const body =
    req.body && typeof req.body === 'object'
      ? (req.body as Record<string, any>)
      : undefined;
  const query = req.query as Record<string, any>;

  const bodyOperationName = body?.operationName;
  if (typeof bodyOperationName === 'string' && bodyOperationName.trim()) {
    return bodyOperationName;
  }

  const queryOperationName = query.operationName;
  if (typeof queryOperationName === 'string' && queryOperationName.trim()) {
    return queryOperationName;
  }

  return null;
};

const shouldAllowLegacyProjectShim = (req: NextApiRequest) => {
  const operationName = readOperationName(req);
  return (
    !!operationName && LEGACY_RUNTIME_SCOPE_OPERATION_NAMES.has(operationName)
  );
};

const shouldRecoverWithNullRuntimeScope = (
  req: NextApiRequest,
  error: Error | null | undefined,
) => {
  const operationName = readOperationName(req);
  return (
    !!operationName &&
    !!error?.message &&
    NULL_RUNTIME_SCOPE_OPERATION_NAMES.has(operationName) &&
    (RECOVERABLE_RUNTIME_SCOPE_ERRORS.has(error.message) ||
      error.message === 'Runtime scope selector is required for this request')
  );
};

export const config: PageConfig = {
  api: {
    bodyParser: false,
  },
};

const bootstrapServer = async () => {
  const {
    telemetry,

    // repositories
    projectRepository,
    modelRepository,
    modelColumnRepository,
    relationRepository,
    deployLogRepository,
    viewRepository,
    schemaChangeRepository,
    learningRepository,
    modelNestedColumnRepository,
    dashboardRepository,
    dashboardItemRepository,
    sqlPairRepository,
    instructionRepository,
    apiHistoryRepository,
    dashboardItemRefreshJobRepository,
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
    userRepository,
    authIdentityRepository,
    authSessionRepository,
    workspaceMemberRepository,
    // adaptors
    wrenEngineAdaptor,
    ibisAdaptor,
    wrenAIAdaptor,

    // services
    projectService,
    queryService,
    askingService,
    deployService,
    mdlService,
    dashboardService,
    sqlPairService,
    instructionService,
    authService,
    workspaceService,
    runtimeScopeResolver,
    // background trackers
    projectRecommendQuestionBackgroundTracker,
    threadRecommendQuestionBackgroundTracker,
    dashboardCacheBackgroundTracker,
  } = components;

  const modelService = new ModelService({
    projectService,
    modelRepository,
    modelColumnRepository,
    relationRepository,
    viewRepository,
    mdlService,
    wrenEngineAdaptor,
    queryService,
  });

  // initialize services
  await Promise.all([
    askingService.initialize(),
    projectRecommendQuestionBackgroundTracker.initialize(),
    threadRecommendQuestionBackgroundTracker.initialize(),
  ]);

  const apolloServer: ApolloServer = new ApolloServer({
    typeDefs,
    resolvers,
    formatError: (error: GraphQLError) => {
      // stop print error stacktrace of dry run error
      if (error.extensions?.code === GeneralErrorCodes.DRY_RUN_ERROR) {
        return defaultApolloErrorHandler(error);
      }

      // print error stacktrace of graphql error
      const stacktrace = error.extensions?.exception?.stacktrace;
      if (stacktrace) {
        logger.error(stacktrace.join('\n'));
      }

      // print original error stacktrace
      const originalError = error.extensions?.originalError as Error;
      if (originalError) {
        logger.error(`== original error ==`);
        // error may not have stack, so print error message if stack is not available
        logger.error(originalError.stack || originalError.message);
      }

      // telemetry: capture internal server error
      if (error.extensions?.code === GeneralErrorCodes.INTERNAL_SERVER_ERROR) {
        telemetry.sendEvent(
          TelemetryEvent.GRAPHQL_ERROR,
          {
            originalErrorStack: originalError?.stack,
            originalErrorMessage: originalError?.message,
            errorMessage: error.message,
          },
          error.extensions?.service,
          false,
        );
      }
      return defaultApolloErrorHandler(error);
    },
    introspection: process.env.NODE_ENV !== 'production',
    context: async ({ req }): Promise<IContext> => {
      let runtimeScope = null;
      const allowLegacyProjectShim = shouldAllowLegacyProjectShim(req);
      try {
        runtimeScope = await runtimeScopeResolver.resolveRequestScope(req, {
          allowLegacyProjectShim,
        });
      } catch (error: any) {
        if (!shouldRecoverWithNullRuntimeScope(req, error)) {
          throw error;
        }
        logger.debug(
          `Runtime scope unavailable during bootstrap flow: ${error.message}`,
        );
      }

      return {
        config: serverConfig,
        telemetry,
        // adaptor
        wrenEngineAdaptor,
        ibisServerAdaptor: ibisAdaptor,
        wrenAIAdaptor,
        // services
        projectService,
        modelService,
        mdlService,
        deployService,
        askingService,
        queryService,
        dashboardService,
        sqlPairService,
        instructionService,
        authService,
        workspaceService,
        runtimeScopeResolver,
        runtimeScope,
        // repository
        projectRepository,
        modelRepository,
        modelColumnRepository,
        modelNestedColumnRepository,
        relationRepository,
        viewRepository,
        deployRepository: deployLogRepository,
        schemaChangeRepository,
        learningRepository,
        dashboardRepository,
        dashboardItemRepository,
        sqlPairRepository,
        instructionRepository,
        apiHistoryRepository,
        dashboardItemRefreshJobRepository,
        workspaceRepository,
        knowledgeBaseRepository,
        kbSnapshotRepository,
        userRepository,
        authIdentityRepository,
        authSessionRepository,
        workspaceMemberRepository,
        // background trackers
        projectRecommendQuestionBackgroundTracker,
        threadRecommendQuestionBackgroundTracker,
        dashboardCacheBackgroundTracker,
      };
    },
  });
  await apolloServer.start();
  return apolloServer;
};

const startServer = bootstrapServer();

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const apolloServer = await startServer;
  await apolloServer.createHandler({
    path: '/api/graphql',
  })(req, res);
};

export default cors((req: NextApiRequest, res: NextApiResponse) =>
  req.method === 'OPTIONS' ? res.status(200).end() : handler(req, res),
);
