import type { NextApiRequest } from 'next';
import { components, serverConfig } from '@/common';
import type { IContext } from '@server/types';
import { resolveRequestActor } from '@server/context/actorClaims';
import {
  RuntimeScopeResolutionError,
  type RuntimeScope,
} from '@server/context/runtimeScope';

const isMissingRuntimeScopeSelectorError = (error: unknown) =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'message' in error &&
    error.message === 'Runtime scope selector is required for this request' &&
    (error instanceof RuntimeScopeResolutionError ||
      ('name' in error && error.name === 'RuntimeScopeResolutionError') ||
      ('statusCode' in error && error.statusCode === 400)),
  );

export const buildApiContextFromRequest = async ({
  req,
  runtimeScope,
  allowMissingRuntimeScope = false,
}: {
  req: NextApiRequest;
  runtimeScope?: RuntimeScope | null;
  allowMissingRuntimeScope?: boolean;
}): Promise<IContext> => {
  let resolvedRuntimeScope = runtimeScope;

  if (resolvedRuntimeScope === undefined) {
    try {
      resolvedRuntimeScope =
        await components.runtimeScopeResolver.resolveRequestScope(req);
    } catch (error) {
      const canIgnoreMissingRuntimeScope = allowMissingRuntimeScope
        ? isMissingRuntimeScopeSelectorError(error)
        : false;

      if (!canIgnoreMissingRuntimeScope) {
        throw error;
      }

      resolvedRuntimeScope = null;
    }
  }

  let requestActor = resolvedRuntimeScope?.requestActor || null;
  let authorizationActor = requestActor?.authorizationActor || null;

  if (!requestActor) {
    try {
      requestActor = await resolveRequestActor({
        req,
        authService: components.authService,
        automationService: components.automationService,
        workspaceId: resolvedRuntimeScope?.workspace?.id,
      });
      authorizationActor = requestActor?.authorizationActor || null;
    } catch (_error) {
      requestActor = null;
      authorizationActor = null;
    }
  }

  return {
    req,
    config: serverConfig,
    telemetry: components.telemetry,
    wrenEngineAdaptor: components.wrenEngineAdaptor,
    ibisServerAdaptor: components.ibisAdaptor,
    wrenAIAdaptor: components.wrenAIAdaptor,
    projectService: components.projectService,
    modelService: components.modelService,
    mdlService: components.mdlService,
    deployService: components.deployService,
    askingService: components.askingService,
    queryService: components.queryService,
    dashboardService: components.dashboardService,
    sqlPairService: components.sqlPairService,
    instructionService: components.instructionService,
    authService: components.authService,
    workspaceService: components.workspaceService,
    secretService: components.secretService,
    connectorService: components.connectorService,
    skillService: components.skillService,
    scheduleService: components.scheduleService,
    runtimeScopeResolver: components.runtimeScopeResolver,
    runtimeScope: resolvedRuntimeScope,
    requestActor,
    authorizationActor,
    projectRepository: components.projectRepository,
    modelRepository: components.modelRepository,
    modelColumnRepository: components.modelColumnRepository,
    modelNestedColumnRepository: components.modelNestedColumnRepository,
    relationRepository: components.relationRepository,
    viewRepository: components.viewRepository,
    deployRepository: components.deployLogRepository,
    schemaChangeRepository: components.schemaChangeRepository,
    learningRepository: components.learningRepository,
    dashboardRepository: components.dashboardRepository,
    dashboardItemRepository: components.dashboardItemRepository,
    sqlPairRepository: components.sqlPairRepository,
    instructionRepository: components.instructionRepository,
    apiHistoryRepository: components.apiHistoryRepository,
    dashboardItemRefreshJobRepository:
      components.dashboardItemRefreshJobRepository,
    workspaceRepository: components.workspaceRepository,
    knowledgeBaseRepository: components.knowledgeBaseRepository,
    kbSnapshotRepository: components.kbSnapshotRepository,
    connectorRepository: components.connectorRepository,
    secretRepository: components.secretRepository,
    skillDefinitionRepository: components.skillDefinitionRepository,
    skillMarketplaceCatalogRepository:
      components.skillMarketplaceCatalogRepository,
    auditEventRepository: components.auditEventRepository,
    userRepository: components.userRepository,
    authIdentityRepository: components.authIdentityRepository,
    authSessionRepository: components.authSessionRepository,
    workspaceMemberRepository: components.workspaceMemberRepository,
    projectRecommendQuestionBackgroundTracker:
      components.projectRecommendQuestionBackgroundTracker,
    threadRecommendQuestionBackgroundTracker:
      components.threadRecommendQuestionBackgroundTracker,
    dashboardCacheBackgroundTracker: components.dashboardCacheBackgroundTracker,
  };
};
