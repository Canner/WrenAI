import { getConfig } from '@server/config';
import { bootstrapKnex } from './apollo/server/utils/knex';
import {
  ProjectRepository,
  ViewRepository,
  DeployLogRepository,
  ThreadRepository,
  ThreadResponseRepository,
  ModelRepository,
  ModelColumnRepository,
  RelationRepository,
  SchemaChangeRepository,
  ModelNestedColumnRepository,
  LearningRepository,
  DashboardItemRepository,
  DashboardRepository,
  SqlPairRepository,
} from '@server/repositories';
import {
  WrenEngineAdaptor,
  WrenAIAdaptor,
  IbisAdaptor,
} from '@server/adaptors';
import {
  DataSourceMetadataService,
  QueryService,
  ProjectService,
  DeployService,
  AskingService,
  MDLService,
  DashboardService,
} from '@server/services';
import { PostHogTelemetry } from './apollo/server/telemetry/telemetry';
import {
  ProjectRecommendQuestionBackgroundTracker,
  ThreadRecommendQuestionBackgroundTracker,
} from './apollo/server/backgrounds';
import { SqlPairService } from './apollo/server/services/sqlPairService';

export const serverConfig = getConfig();

export const initComponents = () => {
  const telemetry = new PostHogTelemetry();
  const knex = bootstrapKnex({
    dbType: serverConfig.dbType,
    pgUrl: serverConfig.pgUrl,
    debug: serverConfig.debug,
    sqliteFile: serverConfig.sqliteFile,
  });

  // repositories
  const projectRepository = new ProjectRepository(knex);
  const deployLogRepository = new DeployLogRepository(knex);
  const threadRepository = new ThreadRepository(knex);
  const threadResponseRepository = new ThreadResponseRepository(knex);
  const viewRepository = new ViewRepository(knex);
  const modelRepository = new ModelRepository(knex);
  const modelColumnRepository = new ModelColumnRepository(knex);
  const modelNestedColumnRepository = new ModelNestedColumnRepository(knex);
  const relationRepository = new RelationRepository(knex);
  const schemaChangeRepository = new SchemaChangeRepository(knex);
  const learningRepository = new LearningRepository(knex);
  const dashboardRepository = new DashboardRepository(knex);
  const dashboardItemRepository = new DashboardItemRepository(knex);
  const sqlPairRepository = new SqlPairRepository(knex);

  // adaptors
  const wrenEngineAdaptor = new WrenEngineAdaptor({
    wrenEngineEndpoint: serverConfig.wrenEngineEndpoint,
  });
  const wrenAIAdaptor = new WrenAIAdaptor({
    wrenAIBaseEndpoint: serverConfig.wrenAIEndpoint,
  });
  const ibisAdaptor = new IbisAdaptor({
    ibisServerEndpoint: serverConfig.ibisServerEndpoint,
  });

  // services
  const metadataService = new DataSourceMetadataService({
    ibisAdaptor,
    wrenEngineAdaptor,
  });
  const queryService = new QueryService({
    ibisAdaptor,
    wrenEngineAdaptor,
    telemetry,
  });
  const deployService = new DeployService({
    wrenAIAdaptor,
    deployLogRepository,
    telemetry,
  });
  const mdlService = new MDLService({
    projectRepository,
    modelRepository,
    modelColumnRepository,
    modelNestedColumnRepository,
    relationRepository,
    viewRepository,
  });
  const projectService = new ProjectService({
    projectRepository,
    metadataService,
    mdlService,
    wrenAIAdaptor,
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
    mdlService,
  });
  const dashboardService = new DashboardService({
    projectService,
    dashboardItemRepository,
    dashboardRepository,
  });
  const sqlPairService = new SqlPairService({
    sqlPairRepository,
    wrenAIAdaptor,
  });
  // background trackers
  const projectRecommendQuestionBackgroundTracker =
    new ProjectRecommendQuestionBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      projectRepository,
    });
  const threadRecommendQuestionBackgroundTracker =
    new ThreadRecommendQuestionBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadRepository,
    });

  return {
    knex,
    telemetry,

    // repositories
    projectRepository,
    deployLogRepository,
    threadRepository,
    threadResponseRepository,
    viewRepository,
    modelRepository,
    modelColumnRepository,
    relationRepository,
    schemaChangeRepository,
    learningRepository,
    modelNestedColumnRepository,
    dashboardRepository,
    dashboardItemRepository,
    sqlPairRepository,
    // adaptors
    wrenEngineAdaptor,
    wrenAIAdaptor,
    ibisAdaptor,

    // services
    metadataService,
    projectService,
    queryService,
    deployService,
    askingService,
    mdlService,
    dashboardService,
    sqlPairService,

    // background trackers
    projectRecommendQuestionBackgroundTracker,
    threadRecommendQuestionBackgroundTracker,
  };
};

// singleton components
export const components = initComponents();
