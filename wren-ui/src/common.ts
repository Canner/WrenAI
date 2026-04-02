import { getConfig } from '@server/config';
import { bootstrapKnex } from './apollo/server/utils/knex';
import {
  AuthIdentityRepository,
  AuthSessionRepository,
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
  WorkspaceRepository,
  UserRepository,
  WorkspaceMemberRepository,
  IdentityProviderConfigRepository,
  KnowledgeBaseRepository,
  KBSnapshotRepository,
  ConnectorRepository,
  SecretRepository,
  SkillDefinitionRepository,
  SkillBindingRepository,
  ScheduleJobRepository,
  ScheduleJobRunRepository,
  AuditEventRepository,
} from '@server/repositories';
import {
  WrenEngineAdaptor,
  WrenAIAdaptor,
  IbisAdaptor,
} from '@server/adaptors';
import {
  AuthService,
  DataSourceMetadataService,
  QueryService,
  ProjectService,
  DeployService,
  AskingService,
  MDLService,
  DashboardService,
  AskingTaskTracker,
  InstructionService,
  WorkspaceService,
  SecretService,
  ConnectorService,
  SkillService,
} from '@server/services';
import { PostHogTelemetry } from './apollo/server/telemetry/telemetry';
import { RuntimeScopeResolver } from './apollo/server/context/runtimeScope';
import {
  ProjectRecommendQuestionBackgroundTracker,
  ThreadRecommendQuestionBackgroundTracker,
  DashboardCacheBackgroundTracker,
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
  const askingTaskRepository = new AskingTaskRepository(knex);
  const instructionRepository = new InstructionRepository(knex);
  const apiHistoryRepository = new ApiHistoryRepository(knex);
  const dashboardItemRefreshJobRepository =
    new DashboardItemRefreshJobRepository(knex);
  const workspaceRepository = new WorkspaceRepository(knex);
  const userRepository = new UserRepository(knex);
  const authIdentityRepository = new AuthIdentityRepository(knex);
  const identityProviderConfigRepository =
    new IdentityProviderConfigRepository(knex);
  const authSessionRepository = new AuthSessionRepository(knex);
  const workspaceMemberRepository = new WorkspaceMemberRepository(knex);
  const knowledgeBaseRepository = new KnowledgeBaseRepository(knex);
  const kbSnapshotRepository = new KBSnapshotRepository(knex);
  const connectorRepository = new ConnectorRepository(knex);
  const secretRepository = new SecretRepository(knex);
  const skillDefinitionRepository = new SkillDefinitionRepository(knex);
  const skillBindingRepository = new SkillBindingRepository(knex);
  const scheduleJobRepository = new ScheduleJobRepository(knex);
  const scheduleJobRunRepository = new ScheduleJobRunRepository(knex);
  const auditEventRepository = new AuditEventRepository(knex);

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
  const askingTaskTracker = new AskingTaskTracker({
    wrenAIAdaptor,
    askingTaskRepository,
    threadResponseRepository,
    viewRepository,
  });
  const dashboardService = new DashboardService({
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
  const workspaceService = new WorkspaceService({
    workspaceRepository,
    workspaceMemberRepository,
    userRepository,
  });
  const authService = new AuthService({
    userRepository,
    authIdentityRepository,
    authSessionRepository,
    workspaceRepository,
    workspaceMemberRepository,
  });
  const secretService = new SecretService({
    secretRepository,
    encryptionPassword: serverConfig.encryptionPassword,
    encryptionSalt: serverConfig.encryptionSalt,
  });
  const connectorService = new ConnectorService({
    connectorRepository,
    workspaceRepository,
    knowledgeBaseRepository,
    secretService,
  });
  const skillService = new SkillService({
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
    connectorRepository,
    skillDefinitionRepository,
    skillBindingRepository,
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
    skillService,
    connectorService,
  });
  const runtimeScopeResolver = new RuntimeScopeResolver({
    projectRepository,
    deployRepository: deployLogRepository,
    deployService,
    authService,
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
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
    workspaceRepository,
    userRepository,
    authIdentityRepository,
    identityProviderConfigRepository,
    authSessionRepository,
    workspaceMemberRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
    connectorRepository,
    secretRepository,
    skillDefinitionRepository,
    skillBindingRepository,
    scheduleJobRepository,
    scheduleJobRunRepository,
    auditEventRepository,

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
    workspaceService,
    authService,
    secretService,
    connectorService,
    skillService,
    runtimeScopeResolver,
    askingTaskTracker,

    // background trackers
    projectRecommendQuestionBackgroundTracker,
    threadRecommendQuestionBackgroundTracker,
    dashboardCacheBackgroundTracker,
  };
};

// singleton components
export const components = initComponents();
