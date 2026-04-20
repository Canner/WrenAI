import { getConfig } from '@server/config';
import { bootstrapKnex } from './server/utils/knex';
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
  ServiceAccountRepository,
  ApiTokenRepository,
  SSOSessionRepository,
  AccessReviewRepository,
  AccessReviewItemRepository,
  DirectoryGroupRepository,
  DirectoryGroupMemberRepository,
  BreakGlassGrantRepository,
  SkillDefinitionRepository,
  SkillMarketplaceCatalogRepository,
  ScheduleJobRepository,
  ScheduleJobRunRepository,
  AuditEventRepository,
  RoleRepository,
  PermissionRepository,
  RolePermissionRepository,
  PrincipalRoleBindingRepository,
} from '@server/repositories';
import {
  WrenEngineAdaptor,
  WrenAIAdaptor,
  IbisAdaptor,
  TrinoAdaptor,
} from '@server/adaptors';
import {
  AuthService,
  ConnectionMetadataService,
  QueryService,
  ProjectService,
  DeployService,
  AskingService,
  ModelService,
  MDLService,
  DashboardService,
  AskingTaskTracker,
  InstructionService,
  WorkspaceService,
  WorkspaceBootstrapService,
  KnowledgeBaseService,
  SecretService,
  ConnectorService,
  FederatedRuntimeProjectService,
  SkillService,
  ScheduleService,
  AutomationService,
  IdentityProviderService,
  GovernanceService,
  ScimService,
} from '@server/services';
import type { IDeployService } from '@server/services/deployService';
import type { IMDLService } from '@server/services/mdlService';
import type { IProjectService } from '@server/services/projectService';
import { PostHogTelemetry } from './server/telemetry/telemetry';
import { RuntimeScopeResolver } from './server/context/runtimeScope';
import { SqlPairService } from './server/services/sqlPairService';
import { createBackgroundTrackers } from './commonBackgroundTrackers';
import { getVersionedGlobalSingleton } from './commonComponentSingleton';
export const serverConfig = getConfig();
export const initComponents = () => {
  const telemetry = new PostHogTelemetry();
  const knex = bootstrapKnex({
    pgUrl: serverConfig.pgUrl,
    debug: serverConfig.debug,
  });
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
  const identityProviderConfigRepository = new IdentityProviderConfigRepository(
    knex,
  );
  const authSessionRepository = new AuthSessionRepository(knex);
  const workspaceMemberRepository = new WorkspaceMemberRepository(knex);
  const knowledgeBaseRepository = new KnowledgeBaseRepository(knex);
  const kbSnapshotRepository = new KBSnapshotRepository(knex);
  const connectorRepository = new ConnectorRepository(knex);
  const secretRepository = new SecretRepository(knex);
  const serviceAccountRepository = new ServiceAccountRepository(knex);
  const apiTokenRepository = new ApiTokenRepository(knex);
  const ssoSessionRepository = new SSOSessionRepository(knex);
  const accessReviewRepository = new AccessReviewRepository(knex);
  const accessReviewItemRepository = new AccessReviewItemRepository(knex);
  const directoryGroupRepository = new DirectoryGroupRepository(knex);
  const directoryGroupMemberRepository = new DirectoryGroupMemberRepository(
    knex,
  );
  const breakGlassGrantRepository = new BreakGlassGrantRepository(knex);
  const skillDefinitionRepository = new SkillDefinitionRepository(knex);
  const skillMarketplaceCatalogRepository =
    new SkillMarketplaceCatalogRepository(knex);
  const scheduleJobRepository = new ScheduleJobRepository(knex);
  const scheduleJobRunRepository = new ScheduleJobRunRepository(knex);
  const auditEventRepository = new AuditEventRepository(knex);
  const roleRepository = new RoleRepository(knex);
  const permissionRepository = new PermissionRepository(knex);
  const rolePermissionRepository = new RolePermissionRepository(knex);
  const principalRoleBindingRepository = new PrincipalRoleBindingRepository(
    knex,
  );
  const wrenEngineAdaptor = new WrenEngineAdaptor({
    wrenEngineEndpoint: serverConfig.wrenEngineEndpoint,
  });
  const wrenAIAdaptor = new WrenAIAdaptor({
    wrenAIBaseEndpoint: serverConfig.wrenAIEndpoint,
  });
  const ibisAdaptor = new IbisAdaptor({
    ibisServerEndpoint: serverConfig.ibisServerEndpoint,
  });
  const trinoAdaptor = new TrinoAdaptor({
    catalogDir: serverConfig.trinoCatalogDir!,
    managementMode: serverConfig.trinoCatalogManagement,
    runtimeHost:
      serverConfig.trinoCatalogManagementHost || serverConfig.trinoRuntimeHost,
    runtimePort:
      serverConfig.trinoCatalogManagementPort || serverConfig.trinoRuntimePort,
    runtimeUser: serverConfig.trinoRuntimeUser,
    runtimePassword: serverConfig.trinoRuntimePassword,
    runtimeSsl:
      serverConfig.trinoCatalogManagementSsl ?? serverConfig.trinoRuntimeSsl,
  });
  const metadataService = new ConnectionMetadataService({
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
  }) as unknown as IDeployService;
  const mdlService = new MDLService({
    projectRepository,
    deployLogRepository,
    modelRepository,
    modelColumnRepository,
    modelNestedColumnRepository,
    relationRepository,
    viewRepository,
    knowledgeBaseRepository,
  }) as unknown as IMDLService;
  const projectService = new ProjectService({
    projectRepository,
    metadataService,
    mdlService,
    wrenAIAdaptor,
    telemetry,
  }) as unknown as IProjectService;
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
    roleRepository,
    principalRoleBindingRepository,
  });
  const secretService = new SecretService({
    secretRepository,
    encryptionPassword: serverConfig.encryptionPassword,
    encryptionSalt: serverConfig.encryptionSalt,
  });
  const federatedRuntimeProjectService = new FederatedRuntimeProjectService({
    knowledgeBaseRepository,
    connectorRepository,
    projectRepository,
    deployLogRepository,
    kbSnapshotRepository,
    modelRepository,
    relationRepository,
    viewRepository,
    secretService,
    trinoAdaptor,
    mdlService,
    deployService,
    runtimeHost: serverConfig.trinoRuntimeHost!,
    runtimePort: serverConfig.trinoRuntimePort!,
    runtimeUser: serverConfig.trinoRuntimeUser!,
    runtimePassword: serverConfig.trinoRuntimePassword || '',
    runtimeSsl: Boolean(serverConfig.trinoRuntimeSsl),
  });
  const knowledgeBaseService = new KnowledgeBaseService({
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
    connectorRepository,
    federatedRuntimeProjectService,
    projectService,
    mdlService,
    deployService,
    deployLogRepository,
  });
  const workspaceBootstrapService = new WorkspaceBootstrapService({
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
    projectRepository,
    projectService,
    modelService,
    modelRepository,
    modelColumnRepository,
    modelNestedColumnRepository,
    relationRepository,
    deployService,
    deployLogRepository,
    mdlService,
    dashboardService,
    wrenEngineAdaptor,
  });
  const authService = new AuthService({
    userRepository,
    authIdentityRepository,
    authSessionRepository,
    workspaceRepository,
    workspaceMemberRepository,
    roleRepository,
    permissionRepository,
    rolePermissionRepository,
    principalRoleBindingRepository,
    directoryGroupRepository,
    directoryGroupMemberRepository,
    breakGlassGrantRepository,
    workspaceBootstrapService,
  });
  const automationService = new AutomationService(
    workspaceRepository,
    serviceAccountRepository,
    apiTokenRepository,
    roleRepository,
    principalRoleBindingRepository,
  );
  const connectorService = new ConnectorService({
    connectorRepository,
    workspaceRepository,
    knowledgeBaseRepository,
    secretService,
    metadataService,
    federatedRuntimeProjectService,
  });
  const skillService = new SkillService({
    workspaceRepository,
    connectorRepository,
    secretService,
    skillDefinitionRepository,
    skillMarketplaceCatalogRepository,
  });
  const scheduleService = new ScheduleService({
    scheduleJobRepository,
  });
  const identityProviderService = new IdentityProviderService(
    workspaceRepository,
    userRepository,
    authIdentityRepository,
    identityProviderConfigRepository,
    ssoSessionRepository,
    workspaceService,
    authService,
  );
  const governanceService = new GovernanceService(
    accessReviewRepository,
    accessReviewItemRepository,
    workspaceMemberRepository,
    userRepository,
    authIdentityRepository,
    authSessionRepository,
    workspaceService,
    authService,
    directoryGroupRepository,
    directoryGroupMemberRepository,
    breakGlassGrantRepository,
    roleRepository,
    principalRoleBindingRepository,
  );
  const scimService = new ScimService(
    workspaceRepository,
    identityProviderConfigRepository,
    userRepository,
    authIdentityRepository,
    workspaceMemberRepository,
    workspaceService,
    governanceService,
  );
  const askingService = new AskingService({
    telemetry,
    wrenAIAdaptor,
    deployService,
    projectService,
    viewRepository,
    threadRepository,
    threadResponseRepository,
    queryService,
    askingTaskTracker,
    askingTaskRepository,
    knowledgeBaseRepository,
    skillService,
    backgroundTrackerWorkspaceId: serverConfig.backgroundTrackerWorkspaceId,
  });
  const runtimeScopeResolver = new RuntimeScopeResolver({
    projectRepository,
    deployService,
    authService,
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
  });
  const {
    projectRecommendQuestionBackgroundTracker,
    threadRecommendQuestionBackgroundTracker,
    dashboardCacheBackgroundTracker,
    scheduleWorker,
  } = createBackgroundTrackers({
    telemetry,
    wrenAIAdaptor,
    projectRepository,
    threadRepository,
    dashboardRepository,
    dashboardItemRepository,
    dashboardItemRefreshJobRepository,
    kbSnapshotRepository,
    projectService,
    deployService,
    queryService,
    scheduleJobRepository,
    scheduleJobRunRepository,
    auditEventRepository,
  });
  return {
    knex,
    telemetry,
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
    serviceAccountRepository,
    apiTokenRepository,
    ssoSessionRepository,
    accessReviewRepository,
    accessReviewItemRepository,
    directoryGroupRepository,
    directoryGroupMemberRepository,
    breakGlassGrantRepository,
    skillDefinitionRepository,
    skillMarketplaceCatalogRepository,
    scheduleJobRepository,
    scheduleJobRunRepository,
    auditEventRepository,
    roleRepository,
    permissionRepository,
    rolePermissionRepository,
    principalRoleBindingRepository,
    wrenEngineAdaptor,
    wrenAIAdaptor,
    ibisAdaptor,
    trinoAdaptor,
    metadataService,
    projectService,
    queryService,
    deployService,
    askingService,
    modelService,
    mdlService,
    dashboardService,
    sqlPairService,
    instructionService,
    workspaceService,
    knowledgeBaseService,
    workspaceBootstrapService,
    authService,
    automationService,
    secretService,
    connectorService,
    federatedRuntimeProjectService,
    skillService,
    scheduleService,
    identityProviderService,
    governanceService,
    scimService,
    runtimeScopeResolver,
    askingTaskTracker,
    scheduleWorker,
    projectRecommendQuestionBackgroundTracker,
    threadRecommendQuestionBackgroundTracker,
    dashboardCacheBackgroundTracker,
  };
};
type Components = ReturnType<typeof initComponents>;
const COMPONENTS_RUNTIME_VERSION = 3;
export const components: Components = getVersionedGlobalSingleton({
  factory: initComponents,
  singletonKey: '__wrenComponents__',
  version: COMPONENTS_RUNTIME_VERSION,
  versionKey: '__wrenComponentsVersion__',
});
