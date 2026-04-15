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
  create as createGraphQLError,
  defaultApolloErrorHandler,
  GeneralErrorCodes,
} from '@/apollo/server/utils/error';
import { TelemetryEvent } from '@/apollo/server/telemetry/telemetry';
import { components } from '@/common';
import { resolveRequestActor } from '@server/context';

const serverConfig = getConfig();
const logger = getLogger('APOLLO');
logger.level = 'debug';

const cors = microCors();

const RECOVERABLE_RUNTIME_SCOPE_ERRORS = new Set([
  'No project found',
  'Workspace scope could not be resolved',
  'Knowledge base does not belong to the requested workspace',
  'kb_snapshot does not belong to the requested knowledge base',
  'No deployment found for the requested runtime scope',
  'deploy_hash does not match the requested kb_snapshot',
  'Session workspace does not match requested workspace',
]);

const NULL_RUNTIME_SCOPE_OPERATION_NAMES = new Set([
  'RuntimeSelectorState',
  'OnboardingStatus',
  'SaveDataSource',
  'StartSampleDataset',
]);
const RUNTIME_SCOPE_BOOTSTRAP_HEADER = 'x-wren-runtime-bootstrap';

const MISSING_RUNTIME_SCOPE_SELECTOR_ERROR =
  'Runtime scope selector is required for this request';

const stripContextCreationPrefix = (message?: string | null) =>
  (message || '').replace(/^Context creation failed:\s*/i, '').trim();

export const classifyRuntimeScopeContextError = (
  message?: string | null,
): {
  code: GeneralErrorCodes;
  customMessage: string;
} | null => {
  const normalizedMessage = stripContextCreationPrefix(message);
  if (!normalizedMessage) {
    return null;
  }

  if (
    normalizedMessage === 'No deployment found for the requested runtime scope'
  ) {
    return {
      code: GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      customMessage:
        'Current knowledge base runtime is unavailable. Refresh or reselect a knowledge base and try again.',
    };
  }

  const isOutdatedRuntimeSnapshotError =
    normalizedMessage ===
    'deploy_hash does not match the requested kb_snapshot';

  if (isOutdatedRuntimeSnapshotError) {
    return {
      code: GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT,
      customMessage:
        'Current knowledge base snapshot is outdated. Refresh or reselect a knowledge base and try again.',
    };
  }

  if (
    normalizedMessage === MISSING_RUNTIME_SCOPE_SELECTOR_ERROR ||
    RECOVERABLE_RUNTIME_SCOPE_ERRORS.has(normalizedMessage)
  ) {
    return {
      code: GeneralErrorCodes.INTERNAL_SERVER_ERROR,
      customMessage:
        'Current workspace context is unavailable. Refresh or reselect a knowledge base and try again.',
    };
  }

  return null;
};

const readParsedBody = (
  req: NextApiRequest,
): Record<string, any> | undefined => {
  if (!req.body) {
    return undefined;
  }

  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, any>;
  }

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : null;

  if (!rawBody) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, any>)
      : undefined;
  } catch {
    return undefined;
  }
};

const readOperationName = (req: NextApiRequest): string | null => {
  const body = readParsedBody(req);
  const query = ((req.query || {}) as Record<string, any>) || {};

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

const shouldRecoverWithNullRuntimeScope = (
  req: NextApiRequest,
  error: Error | null | undefined,
) => {
  const operationName = readOperationName(req);
  const runtimeBootstrapHeader = req.headers[RUNTIME_SCOPE_BOOTSTRAP_HEADER];
  const isRuntimeBootstrapRequest = Array.isArray(runtimeBootstrapHeader)
    ? runtimeBootstrapHeader.includes('1')
    : runtimeBootstrapHeader === '1';

  if (error?.message === MISSING_RUNTIME_SCOPE_SELECTOR_ERROR) {
    return true;
  }

  return (
    (isRuntimeBootstrapRequest ||
      (!!operationName &&
        NULL_RUNTIME_SCOPE_OPERATION_NAMES.has(operationName))) &&
    !!error?.message &&
    (RECOVERABLE_RUNTIME_SCOPE_ERRORS.has(error.message) ||
      error.message === MISSING_RUNTIME_SCOPE_SELECTOR_ERROR)
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
    connectorRepository,
    secretRepository,
    skillDefinitionRepository,
    skillMarketplaceCatalogRepository,
    auditEventRepository,
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
    secretService,
    connectorService,
    skillService,
    scheduleService,
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
      const originalError = error.extensions?.originalError as Error;
      const runtimeScopeContextError = classifyRuntimeScopeContextError(
        error.message || originalError?.message,
      );
      if (runtimeScopeContextError) {
        return defaultApolloErrorHandler(
          createGraphQLError(runtimeScopeContextError.code, {
            customMessage: runtimeScopeContextError.customMessage,
            originalError,
          }),
        );
      }

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
      let requestActor = null;
      let authorizationActor = null;
      try {
        runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
      } catch (error: any) {
        if (!shouldRecoverWithNullRuntimeScope(req, error)) {
          throw error;
        }
        logger.debug(
          `Runtime scope unavailable during bootstrap flow: ${error.message}`,
        );
      }

      try {
        requestActor = await resolveRequestActor({
          req,
          authService,
          automationService: components.automationService,
          workspaceId: runtimeScope?.workspace?.id,
        });
        authorizationActor = requestActor?.authorizationActor || null;
      } catch (error: any) {
        logger.debug(`Request actor unavailable: ${error.message}`);
      }

      return {
        req,
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
        secretService,
        connectorService,
        skillService,
        scheduleService,
        runtimeScopeResolver,
        runtimeScope,
        requestActor,
        authorizationActor,
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
        connectorRepository,
        secretRepository,
        skillDefinitionRepository,
        skillMarketplaceCatalogRepository,
        auditEventRepository,
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

export default cors(((req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  void handler(req, res);
}) as any);
