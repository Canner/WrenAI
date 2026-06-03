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
  AskingTaskRepository,
  InstructionRepository,
  ApiHistoryRepository,
  DashboardItemRefreshJobRepository,
<<<<<<< HEAD
  RoleRepository,
  UserRepository,
  UserRoleRepository,
=======
  OrganizationRepository,
>>>>>>> 52a339fb5 (Add organization management feature)
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
  AskingTaskTracker,
  InstructionService,
<<<<<<< HEAD
  RbacService,
=======
  OrganizationService,
>>>>>>> 52a339fb5 (Add organization management feature)
} from '@server/services';
import { PostHogTelemetry } from './apollo/server/telemetry/telemetry';
import {
  ProjectRecommendQuestionBackgroundTracker,
  ThreadRecommendQuestionBackgroundTracker,
  DashboardCacheBackgroundTracker,
  ChartBackgroundTracker,
  ChartAdjustmentBackgroundTracker,
} from './apollo/server/backgrounds';
import { SqlPairService } from './apollo/server/services/sqlPairService';

export const serverConfig = getConfig();

type Initializable = {
  initialize?: unknown;
};

type Disposable = {
  dispose?: unknown;
  stop?: unknown;
};

type ReusableComponentGraph = {
  askingTaskTracker?: Initializable & Disposable;
  askingService?: Initializable & Disposable;
  projectService?: Disposable;
  projectRecommendQuestionBackgroundTracker?: Initializable & Disposable;
  threadRecommendQuestionBackgroundTracker?: Initializable & Disposable;
  dashboardCacheBackgroundTracker?: Disposable;
  knex?: {
    destroy?: () => unknown;
  };
};

const hasInitialize = (
  value: Initializable | null | undefined,
): value is { initialize: () => Promise<void> | void } => {
  return typeof value?.initialize === 'function';
};

const isReusableComponentGraph = (graph?: ReusableComponentGraph): boolean => {
  const nestedAskingTaskTracker = (
    graph?.askingService as { askingTaskTracker?: Initializable } | undefined
  )?.askingTaskTracker;

  return Boolean(
    graph &&
      hasInitialize(graph.askingTaskTracker) &&
      hasInitialize(graph.askingService) &&
      hasInitialize(nestedAskingTaskTracker) &&
      hasInitialize(graph.projectRecommendQuestionBackgroundTracker) &&
      hasInitialize(graph.threadRecommendQuestionBackgroundTracker),
  );
};

const disposeComponentGraph = (graph?: ReusableComponentGraph): void => {
  const disposables = [
    graph?.askingService,
    graph?.askingTaskTracker,
    graph?.projectService,
    graph?.projectRecommendQuestionBackgroundTracker,
    graph?.threadRecommendQuestionBackgroundTracker,
    graph?.dashboardCacheBackgroundTracker,
  ];

  disposables.forEach((disposable) => {
    if (typeof disposable?.dispose === 'function') {
      disposable.dispose();
    } else if (typeof disposable?.stop === 'function') {
      disposable.stop();
    }
  });

  if (typeof graph?.knex?.destroy === 'function') {
    void Promise.resolve(graph.knex.destroy()).catch(() => undefined);
  }
};

export const initComponents = () => {
  const telemetry = new PostHogTelemetry();
  const knex = bootstrapKnex({
    dbType: serverConfig.dbType,
    pgUrl: serverConfig.pgUrl,
    debug: serverConfig.debug,
    mssqlUrl: serverConfig.mssqlUrl,
    mssqlHost: serverConfig.mssqlHost,
    mssqlPort: serverConfig.mssqlPort,
    mssqlDatabase: serverConfig.mssqlDatabase,
    mssqlUser: serverConfig.mssqlUser,
    mssqlPassword: serverConfig.mssqlPassword,
    mssqlEncrypt: serverConfig.mssqlEncrypt,
    mssqlTrustServerCertificate: serverConfig.mssqlTrustServerCertificate,
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
  const askingTaskRepository = new AskingTaskRepository(knex);
  const instructionRepository = new InstructionRepository(knex);
  const apiHistoryRepository = new ApiHistoryRepository(knex);
  const dashboardItemRefreshJobRepository =
    new DashboardItemRefreshJobRepository(knex);
<<<<<<< HEAD
  const roleRepository = new RoleRepository(knex);
  const userRepository = new UserRepository(knex);
  const userRoleRepository = new UserRoleRepository(knex);
=======
  const organizationRepository = new OrganizationRepository(knex);
>>>>>>> 52a339fb5 (Add organization management feature)

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
  const chartBackgroundTracker = new ChartBackgroundTracker({
    telemetry,
    wrenAIAdaptor,
    threadResponseRepository,
  });
  const chartAdjustmentBackgroundTracker = new ChartAdjustmentBackgroundTracker(
    {
      telemetry,
      wrenAIAdaptor,
      threadResponseRepository,
    },
  );

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
    projectRecommendQuestionBackgroundTracker,
  });
  const askingTaskTracker = new AskingTaskTracker({
    wrenAIAdaptor,
    askingTaskRepository,
    threadResponseRepository,
    viewRepository,
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
    askingTaskTracker,
    askingTaskRepository,
    chartBackgroundTracker,
    chartAdjustmentBackgroundTracker,
    threadRecommendQuestionBackgroundTracker,
  });
  const dashboardService = new DashboardService({
    projectService,
    dashboardItemRepository,
    dashboardRepository,
  });
  const sqlPairService = new SqlPairService({
    sqlPairRepository,
    wrenAIAdaptor,
    ibisAdaptor,
  });
  const instructionService = new InstructionService({
    instructionRepository,
    wrenAIAdaptor,
  });
<<<<<<< HEAD
  const rbacService = new RbacService({
    roleRepository,
    userRepository,
    userRoleRepository,
=======
  const organizationService = new OrganizationService({
    organizationRepository,
>>>>>>> 52a339fb5 (Add organization management feature)
  });

  const dashboardCacheBackgroundTracker = new DashboardCacheBackgroundTracker({
    dashboardRepository,
    dashboardItemRepository,
    dashboardItemRefreshJobRepository,
    projectService,
    deployService,
    queryService,
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
    askingTaskRepository,
    apiHistoryRepository,
    instructionRepository,
    dashboardItemRefreshJobRepository,
<<<<<<< HEAD
    roleRepository,
    userRepository,
    userRoleRepository,
=======
    organizationRepository,
>>>>>>> 52a339fb5 (Add organization management feature)

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
    instructionService,
<<<<<<< HEAD
    rbacService,
=======
    organizationService,
>>>>>>> 52a339fb5 (Add organization management feature)
    askingTaskTracker,

    // background trackers
    projectRecommendQuestionBackgroundTracker,
    threadRecommendQuestionBackgroundTracker,
    dashboardCacheBackgroundTracker,
  };
};

declare global {
  // eslint-disable-next-line no-var
  var __wrenComponents: ReturnType<typeof initComponents> | undefined;
}

// Keep a single server-side component graph across Next.js dev reloads.
const existingComponents = globalThis.__wrenComponents;

if (!isReusableComponentGraph(existingComponents)) {
  disposeComponentGraph(existingComponents);
  globalThis.__wrenComponents = initComponents();
}

export const components = globalThis.__wrenComponents;
