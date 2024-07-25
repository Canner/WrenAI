import microCors from 'micro-cors';
import { NextApiRequest, NextApiResponse, PageConfig } from 'next';
import { ApolloServer } from 'apollo-server-micro';
import { typeDefs } from '@server';
import resolvers from '@server/resolvers';
import { IContext } from '@server/types';
import {
  ModelColumnRepository,
  ModelRepository,
  ProjectRepository,
  RelationRepository,
  ViewRepository,
} from '@server/repositories';
import { bootstrapKnex } from '../../apollo/server/utils/knex';
import { GraphQLError } from 'graphql';
import { getLogger } from '@server/utils';
import { getConfig } from '@server/config';
import { ProjectService } from '@server/services/projectService';
import { ModelService } from '@server/services/modelService';
import { MDLService } from '@server/services/mdlService';
import { WrenEngineAdaptor } from '@/apollo/server/adaptors/wrenEngineAdaptor';
import { DeployLogRepository } from '@/apollo/server/repositories/deployLogRepository';
import { DeployService } from '@/apollo/server/services/deployService';
import { WrenAIAdaptor } from '@/apollo/server/adaptors/wrenAIAdaptor';
import { AskingService } from '@/apollo/server/services/askingService';
import { ThreadRepository } from '@/apollo/server/repositories/threadRepository';
import { ThreadResponseRepository } from '@/apollo/server/repositories/threadResponseRepository';
import { SchemaChangeRepository } from '@/apollo/server/repositories/schemaChangeRepository';
import {
  defaultApolloErrorHandler,
  GeneralErrorCodes,
} from '@/apollo/server/utils/error';
import {
  PostHogTelemetry,
  TelemetryEvent,
} from '@/apollo/server/telemetry/telemetry';
import { IbisAdaptor } from '@/apollo/server/adaptors/ibisAdaptor';
import {
  DataSourceMetadataService,
  QueryService,
} from '@/apollo/server/services';

const serverConfig = getConfig();
const logger = getLogger('APOLLO');
logger.level = 'debug';

const cors = microCors();

export const config: PageConfig = {
  api: {
    bodyParser: false,
  },
};

const bootstrapServer = async () => {
  const telemetry = new PostHogTelemetry();

  const knex = bootstrapKnex({
    dbType: serverConfig.dbType,
    pgUrl: serverConfig.pgUrl,
    debug: serverConfig.debug,
    sqliteFile: serverConfig.sqliteFile,
  });

  const projectRepository = new ProjectRepository(knex);
  const modelRepository = new ModelRepository(knex);
  const modelColumnRepository = new ModelColumnRepository(knex);
  const relationRepository = new RelationRepository(knex);
  const deployLogRepository = new DeployLogRepository(knex);
  const threadRepository = new ThreadRepository(knex);
  const threadResponseRepository = new ThreadResponseRepository(knex);
  const viewRepository = new ViewRepository(knex);
  const schemaChangeRepository = new SchemaChangeRepository(knex);

  const wrenEngineAdaptor = new WrenEngineAdaptor({
    wrenEngineEndpoint: serverConfig.wrenEngineEndpoint,
  });
  const wrenAIAdaptor = new WrenAIAdaptor({
    wrenAIBaseEndpoint: serverConfig.wrenAIEndpoint,
  });
  const ibisAdaptor = new IbisAdaptor({
    ibisServerEndpoint: serverConfig.ibisServerEndpoint,
  });

  const metadataService = new DataSourceMetadataService({
    ibisAdaptor,
    wrenEngineAdaptor,
  });

  const projectService = new ProjectService({
    projectRepository,
    metadataService,
  });
  const mdlService = new MDLService({
    projectRepository,
    modelRepository,
    modelColumnRepository,
    relationRepository,
    viewRepository,
  });
  const queryService = new QueryService({
    ibisAdaptor,
    wrenEngineAdaptor,
  });
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
  const deployService = new DeployService({
    wrenAIAdaptor,
    deployLogRepository,
    telemetry,
  });

  const askingService = new AskingService({
    telemetry,
    wrenAIAdaptor,
    deployService,
    projectService,
    viewRepository,
    threadRepository,
    threadResponseRepository,
    queryService,
  });

  // initialize services
  await askingService.initialize();

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
            originalErrorMessage: originalError.message,
            errorMessage: error.message,
          },
          error.extensions?.service,
          false,
        );
      }
      return defaultApolloErrorHandler(error);
    },
    introspection: process.env.NODE_ENV !== 'production',
    context: (): IContext => ({
      config: serverConfig,
      telemetry,
      // adaptor
      wrenEngineAdaptor,
      ibisServerAdaptor: ibisAdaptor,

      // services
      projectService,
      modelService,
      mdlService,
      deployService,
      askingService,
      queryService,

      // repository
      projectRepository,
      modelRepository,
      modelColumnRepository,
      relationRepository,
      viewRepository,
      deployRepository: deployLogRepository,
      schemaChangeRepository,
    }),
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
