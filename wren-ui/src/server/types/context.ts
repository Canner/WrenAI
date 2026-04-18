import { IConfig } from '@server/config';
import {
  IRuntimeScopeResolver,
  RuntimeScope,
} from '@server/context/runtimeScope';
import { ResolvedRequestActor } from '@server/context/actorClaims';
import { AuthorizationActor } from '@server/authz';
import {
  IIbisAdaptor,
  IWrenAIAdaptor,
  IWrenEngineAdaptor,
} from '@server/adaptors';
import {
  IAuthIdentityRepository,
  IAuthSessionRepository,
  IModelColumnRepository,
  IModelNestedColumnRepository,
  IModelRepository,
  IProjectRepository,
  IRelationRepository,
  IViewRepository,
  ILearningRepository,
  ISchemaChangeRepository,
  IDeployLogRepository,
  IDashboardRepository,
  IDashboardItemRepository,
  ISqlPairRepository,
  IInstructionRepository,
  IApiHistoryRepository,
  IDashboardItemRefreshJobRepository,
  IKnowledgeBaseRepository,
  IKBSnapshotRepository,
  IConnectorRepository,
  ISecretRepository,
  ISkillDefinitionRepository,
  ISkillMarketplaceCatalogRepository,
  IAuditEventRepository,
  IUserRepository,
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
} from '@server/repositories';
import {
  IAuthService,
  IQueryService,
  IAskingService,
  IDeployService,
  IModelService,
  IMDLService,
  IProjectService,
  IDashboardService,
  IInstructionService,
  IWorkspaceService,
  ISecretService,
  IConnectorService,
  ISkillService,
  IScheduleService,
} from '@server/services';
import { ITelemetry } from '@server/telemetry/telemetry';
import {
  ProjectRecommendQuestionBackgroundTracker,
  ThreadRecommendQuestionBackgroundTracker,
  DashboardCacheBackgroundTracker,
} from '@server/backgrounds';
import { ISqlPairService } from '../services/sqlPairService';
import { NextApiRequest } from 'next';

export interface IContext {
  req?: NextApiRequest;
  config: IConfig;
  // telemetry
  telemetry: ITelemetry;

  // adaptor
  wrenEngineAdaptor: IWrenEngineAdaptor;
  ibisServerAdaptor: IIbisAdaptor;
  wrenAIAdaptor: IWrenAIAdaptor;

  // services
  projectService: IProjectService;
  modelService: IModelService;
  mdlService: IMDLService;
  deployService: IDeployService;
  askingService: IAskingService;
  queryService: IQueryService;
  dashboardService: IDashboardService;
  sqlPairService: ISqlPairService;
  instructionService: IInstructionService;
  authService: IAuthService;
  workspaceService: IWorkspaceService;
  secretService: ISecretService;
  connectorService: IConnectorService;
  skillService: ISkillService;
  scheduleService: IScheduleService;
  runtimeScopeResolver: IRuntimeScopeResolver;
  runtimeScope: RuntimeScope | null;
  requestActor: ResolvedRequestActor | null;
  authorizationActor: AuthorizationActor | null;

  // repository
  projectRepository: IProjectRepository;
  modelRepository: IModelRepository;
  modelColumnRepository: IModelColumnRepository;
  modelNestedColumnRepository: IModelNestedColumnRepository;
  relationRepository: IRelationRepository;
  viewRepository: IViewRepository;
  deployRepository: IDeployLogRepository;
  schemaChangeRepository: ISchemaChangeRepository;
  learningRepository: ILearningRepository;
  dashboardRepository: IDashboardRepository;
  dashboardItemRepository: IDashboardItemRepository;
  sqlPairRepository: ISqlPairRepository;
  instructionRepository: IInstructionRepository;
  apiHistoryRepository: IApiHistoryRepository;
  dashboardItemRefreshJobRepository: IDashboardItemRefreshJobRepository;
  workspaceRepository: IWorkspaceRepository;
  knowledgeBaseRepository: IKnowledgeBaseRepository;
  kbSnapshotRepository: IKBSnapshotRepository;
  connectorRepository: IConnectorRepository;
  secretRepository: ISecretRepository;
  skillDefinitionRepository: ISkillDefinitionRepository;
  skillMarketplaceCatalogRepository: ISkillMarketplaceCatalogRepository;
  auditEventRepository: IAuditEventRepository;
  userRepository: IUserRepository;
  authIdentityRepository: IAuthIdentityRepository;
  authSessionRepository: IAuthSessionRepository;
  workspaceMemberRepository: IWorkspaceMemberRepository;

  // background trackers
  projectRecommendQuestionBackgroundTracker: ProjectRecommendQuestionBackgroundTracker;
  threadRecommendQuestionBackgroundTracker: ThreadRecommendQuestionBackgroundTracker;
  dashboardCacheBackgroundTracker: DashboardCacheBackgroundTracker;
}
