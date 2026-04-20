import { DataSourceName } from '@server/types';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  isPersistedRuntimeIdentityMatch,
  normalizeCanonicalPersistedRuntimeIdentity,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import { resolveProjectLanguage } from '@server/utils/runtimeExecutionContext';
import { Project, Thread } from '../repositories';
import { Deploy } from '../repositories/deployLogRepository';
import { Manifest, WrenEngineDataSourceType } from '../mdl/type';
import { getConfig } from '@server/config';
import {
  AskingPayload,
  InstantRecommendedQuestionTask,
  logger,
} from './askingServiceShared';
import { RecommendationQuestion, WrenAILanguage } from '@server/models/adaptor';

const config = getConfig();

interface RuntimeSupportServiceLike {
  backgroundTrackerWorkspaceId?: string | null;
  knowledgeBaseRepository?: Pick<any, 'findOneBy' | 'findAll'>;
  deployService: Pick<
    any,
    'getLastDeploymentByRuntimeIdentity' | 'getDeploymentByRuntimeIdentity'
  >;
  projectService: Pick<any, 'getProjectById'>;
  askingTaskRepository?: Pick<any, 'findByQueryId' | 'createOne'>;
  threadRepository: Pick<any, 'findOneBy'>;
  instantRecommendedQuestionTasks: Map<string, InstantRecommendedQuestionTask>;
  getExecutionResources?(runtimeIdentity: PersistedRuntimeIdentity): Promise<{
    project: Project;
    deployment?: Deploy;
    manifest?: Deploy['manifest'];
  }>;
}

export const resolveBreakdownBootstrapWorkspaceId = async (
  service: RuntimeSupportServiceLike,
): Promise<string | null> => {
  if (service.backgroundTrackerWorkspaceId) {
    return service.backgroundTrackerWorkspaceId;
  }

  const knowledgeBases =
    ((await service.knowledgeBaseRepository?.findAll?.()) as Array<{
      workspaceId?: string | null;
    }>) || [];
  const workspaceIds: string[] = Array.from(
    new Set(
      knowledgeBases
        .map((knowledgeBase) => knowledgeBase.workspaceId)
        .filter(
          (workspaceId): workspaceId is string =>
            typeof workspaceId === 'string' && workspaceId.length > 0,
        ),
    ),
  );

  return workspaceIds.length === 1 ? workspaceIds[0] : null;
};

export const getDeployId = async (
  service: RuntimeSupportServiceLike,
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  const deploymentLookupIdentity =
    buildPersistedRuntimeIdentityPatch(runtimeIdentity);
  const lastDeploy =
    await service.deployService.getLastDeploymentByRuntimeIdentity(
      deploymentLookupIdentity,
    );
  if (!lastDeploy) {
    throw new Error('No deployment found, please deploy your project first');
  }
  return lastDeploy.hash;
};

export const getProjectAndDeployment = async (
  service: RuntimeSupportServiceLike,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<{ project: Project; deployment: Deploy }> => {
  const deploymentLookupIdentity = runtimeIdentity.deployHash
    ? buildPersistedRuntimeIdentityPatch(runtimeIdentity)
    : runtimeIdentity;
  const deployment = await service.deployService.getDeploymentByRuntimeIdentity(
    deploymentLookupIdentity,
  );

  if (!deployment) {
    throw new Error('No deployment found, please deploy your project first');
  }

  const project =
    (await service.projectService.getProjectById(deployment.projectId)) ||
    buildManifestBackedProject(deployment);
  if (!project) {
    throw new Error(`Project ${deployment.projectId} not found`);
  }

  return { project, deployment };
};

export const resolveScopedKnowledgeBaseIds = (
  inputKnowledgeBaseIds?: string[] | null,
  thread?: Thread | null,
  runtimeIdentity?: PersistedRuntimeIdentity | null,
) =>
  Array.from(
    new Set(
      [
        ...(thread?.knowledgeBaseIds || []),
        ...(inputKnowledgeBaseIds || []),
        runtimeIdentity?.knowledgeBaseId || null,
      ].filter(Boolean),
    ),
  ) as string[];

export const resolveRuntimeIdentityFromKnowledgeSelection = async (
  service: RuntimeSupportServiceLike,
  runtimeIdentity: PersistedRuntimeIdentity,
  knowledgeBaseIds: string[],
): Promise<PersistedRuntimeIdentity> => {
  if (
    runtimeIdentity.knowledgeBaseId ||
    !runtimeIdentity.workspaceId ||
    knowledgeBaseIds.length === 0
  ) {
    return runtimeIdentity;
  }

  const primaryKnowledgeBaseId = knowledgeBaseIds[0];
  const lastDeploy =
    runtimeIdentity.deployHash ||
    (
      await service.deployService.getLastDeploymentByRuntimeIdentity({
        ...buildPersistedRuntimeIdentityPatch(runtimeIdentity),
        workspaceId: runtimeIdentity.workspaceId,
        knowledgeBaseId: primaryKnowledgeBaseId,
        kbSnapshotId: null,
        deployHash: null,
        projectId: null,
      })
    )?.hash;

  return buildPersistedRuntimeIdentityPatch({
    ...runtimeIdentity,
    knowledgeBaseId: primaryKnowledgeBaseId,
    deployHash: lastDeploy || null,
  });
};

export const resolveScopedSelectedSkillIds = (
  inputSelectedSkillIds?: string[] | null,
  thread?: Thread | null,
) => {
  if (Array.isArray(thread?.selectedSkillIds)) {
    return Array.from(
      new Set((thread?.selectedSkillIds || []).filter(Boolean)),
    );
  }
  if (Array.isArray(inputSelectedSkillIds)) {
    return Array.from(new Set((inputSelectedSkillIds || []).filter(Boolean)));
  }
  return undefined;
};

export const resolveRetrievalScopeIds = async (
  service: RuntimeSupportServiceLike,
  knowledgeBaseIds: string[],
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  const scopedKnowledgeBaseIds = Array.from(
    new Set(
      [...knowledgeBaseIds, runtimeIdentity.knowledgeBaseId || null].filter(
        Boolean,
      ),
    ),
  ) as string[];

  const workspaceId = runtimeIdentity.workspaceId || null;
  const scopeIds = await Promise.all(
    scopedKnowledgeBaseIds.map(async (knowledgeBaseId) => {
      if (
        knowledgeBaseId === runtimeIdentity.knowledgeBaseId &&
        runtimeIdentity.deployHash
      ) {
        return runtimeIdentity.deployHash;
      }

      if (!workspaceId) {
        return knowledgeBaseId;
      }

      const deployment =
        await service.deployService.getLastDeploymentByRuntimeIdentity({
          projectId: null,
          workspaceId,
          knowledgeBaseId,
          kbSnapshotId: null,
          deployHash: null,
        });

      return deployment?.hash || knowledgeBaseId;
    }),
  );

  return Array.from(new Set(scopeIds.filter(Boolean)));
};

export const resolveAskingRuntimeIdentity = (
  payload: AskingPayload,
  threadRuntimeIdentity?: PersistedRuntimeIdentity | null,
): PersistedRuntimeIdentity => {
  if (threadRuntimeIdentity) {
    return threadRuntimeIdentity;
  }
  if (!payload.runtimeIdentity) {
    throw new Error(
      'createAskingTask requires runtime identity when threadId is absent',
    );
  }
  return normalizeCanonicalPersistedRuntimeIdentity(
    toPersistedRuntimeIdentityFromSource(payload.runtimeIdentity),
  );
};

export const buildPersistedRuntimeIdentityPatch = (
  runtimeIdentity: PersistedRuntimeIdentity,
): PersistedRuntimeIdentity =>
  normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);

export const ensureTrackedAskingTaskPersisted = async (
  service: RuntimeSupportServiceLike,
  queryId: string,
  question: string,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<void> => {
  if (!service.askingTaskRepository) {
    return;
  }
  const existingTask =
    await service.askingTaskRepository.findByQueryId(queryId);
  if (existingTask) {
    return;
  }

  await service.askingTaskRepository.createOne({
    queryId,
    question,
    detail: {
      type: null,
      status: 'UNDERSTANDING',
      response: [],
      error: null,
    },
    ...buildPersistedRuntimeIdentityPatch(runtimeIdentity),
  });
};

export const getThreadById = async (
  service: RuntimeSupportServiceLike,
  threadId: number,
): Promise<Thread> => {
  const thread = await service.threadRepository.findOneBy({ id: threadId });
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }
  return thread;
};

export const getThreadRuntimeIdentity = async (
  service: RuntimeSupportServiceLike,
  threadId: number,
  fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
): Promise<PersistedRuntimeIdentity> => {
  const runtimeIdentityFallback = fallbackRuntimeIdentity
    ? normalizeCanonicalPersistedRuntimeIdentity({
        ...fallbackRuntimeIdentity,
        deployHash: null,
      })
    : null;

  return toPersistedRuntimeIdentityFromSource(
    await getThreadById(service, threadId),
    runtimeIdentityFallback,
  );
};

export const getThreadResponseRuntimeIdentity = async (
  service: RuntimeSupportServiceLike,
  threadResponse: any,
  fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
): Promise<PersistedRuntimeIdentity> => {
  const threadIdentity = await getThreadRuntimeIdentity(
    service,
    threadResponse.threadId,
    fallbackRuntimeIdentity,
  );
  return toPersistedRuntimeIdentityFromSource(threadResponse, threadIdentity);
};

export const getExecutionResources = async (
  service: RuntimeSupportServiceLike,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<{
  project: Project;
  deployment: Deploy;
  manifest: Deploy['manifest'];
}> => {
  const { project, deployment } = await getProjectAndDeployment(
    service,
    runtimeIdentity,
  );
  return { project, deployment, manifest: deployment.manifest };
};

export const getThreadRecommendationQuestionsConfig = (project: Project) => ({
  maxCategories: config.threadRecommendationQuestionMaxCategories,
  maxQuestions: config.threadRecommendationQuestionsMaxQuestions,
  configuration: {
    language: resolveProjectLanguage(project),
  },
});

export const isLikelyNonChineseQuestions = (
  questions: RecommendationQuestion[] | undefined | null,
): boolean => {
  if (!questions?.length) {
    return false;
  }
  const joined = questions
    .map((item) => `${item?.category || ''} ${item?.question || ''}`)
    .join(' ');
  return !/[\u3400-\u9FFF]/.test(joined);
};

export const shouldForceChineseThreadRecommendation = async (
  service: RuntimeSupportServiceLike,
  thread: Thread,
): Promise<boolean> => {
  try {
    const runtimeIdentity = toPersistedRuntimeIdentityFromSource(thread);
    const { project } = service.getExecutionResources
      ? await service.getExecutionResources(runtimeIdentity)
      : await getExecutionResources(service, runtimeIdentity);
    const knowledgeBase =
      runtimeIdentity.knowledgeBaseId && service.knowledgeBaseRepository
        ? await service.knowledgeBaseRepository.findOneBy({
            id: runtimeIdentity.knowledgeBaseId,
          })
        : null;
    const preferredLanguage = resolveProjectLanguage(project, knowledgeBase);
    return (
      preferredLanguage === WrenAILanguage.ZH_CN ||
      preferredLanguage === WrenAILanguage.ZH_TW
    );
  } catch (error) {
    logger.warn(
      `failed to resolve thread recommendation language for thread ${thread.id}: ${error}`,
    );
    return false;
  }
};

export const trackInstantRecommendedQuestionTask = (
  service: RuntimeSupportServiceLike,
  queryId: string,
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  service.instantRecommendedQuestionTasks.set(queryId, {
    runtimeIdentity: normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity,
    createdAt: Date.now(),
  });
};

export const assertInstantRecommendedQuestionTaskScope = (
  service: RuntimeSupportServiceLike,
  queryId: string,
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  const task = service.instantRecommendedQuestionTasks.get(queryId);
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  if (
    !task ||
    !isPersistedRuntimeIdentityMatch(
      task.runtimeIdentity,
      scopedRuntimeIdentity,
    )
  ) {
    throw new Error('Instant recommended questions task not found');
  }
};

export const buildManifestBackedProject = (
  deployment: Deploy,
): Project | null => {
  if (!deployment?.manifest) {
    return null;
  }
  const manifest = deployment.manifest as Manifest;
  if (!manifest.catalog || !manifest.schema || !manifest.dataSource) {
    return null;
  }
  const type = mapManifestDataSourceToProjectType(manifest.dataSource);
  if (!type) {
    return null;
  }

  return {
    id: deployment.projectId,
    type,
    version: '',
    displayName: '',
    catalog: manifest.catalog,
    schema: manifest.schema,
    sampleDataset: null as any,
    connectionInfo: {} as any,
    language: undefined,
    queryId: undefined,
    questions: [],
    questionsStatus: undefined,
    questionsError: undefined,
  };
};

export const mapManifestDataSourceToProjectType = (
  dataSource: WrenEngineDataSourceType,
): DataSourceName | null => {
  switch (dataSource) {
    case WrenEngineDataSourceType.ATHENA:
      return DataSourceName.ATHENA;
    case WrenEngineDataSourceType.BIGQUERY:
      return DataSourceName.BIG_QUERY;
    case WrenEngineDataSourceType.CLICKHOUSE:
      return DataSourceName.CLICK_HOUSE;
    case WrenEngineDataSourceType.MSSQL:
      return DataSourceName.MSSQL;
    case WrenEngineDataSourceType.ORACLE:
      return DataSourceName.ORACLE;
    case WrenEngineDataSourceType.MYSQL:
      return DataSourceName.MYSQL;
    case WrenEngineDataSourceType.POSTGRES:
      return DataSourceName.POSTGRES;
    case WrenEngineDataSourceType.SNOWFLAKE:
      return DataSourceName.SNOWFLAKE;
    case WrenEngineDataSourceType.TRINO:
      return DataSourceName.TRINO;
    case WrenEngineDataSourceType.DUCKDB:
      return DataSourceName.DUCKDB;
    case WrenEngineDataSourceType.DATABRICKS:
      return DataSourceName.DATABRICKS;
    case WrenEngineDataSourceType.REDSHIFT:
      return DataSourceName.REDSHIFT;
    default:
      return null;
  }
};

export const toAskRuntimeIdentity = (
  runtimeIdentity?: PersistedRuntimeIdentity | null,
) => {
  if (!runtimeIdentity) return undefined;
  return {
    ...(typeof runtimeIdentity.projectId === 'number'
      ? { projectId: runtimeIdentity.projectId }
      : {}),
    workspaceId: runtimeIdentity.workspaceId ?? null,
    knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
    kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
    deployHash: runtimeIdentity.deployHash ?? null,
    actorUserId: runtimeIdentity.actorUserId ?? null,
  };
};

export const buildAskTaskRuntimeIdentity = (
  runtimeIdentity: PersistedRuntimeIdentity,
  deployHash?: string | null,
) => ({
  ...(typeof runtimeIdentity.projectId === 'number'
    ? { projectId: runtimeIdentity.projectId }
    : {}),
  workspaceId: runtimeIdentity.workspaceId ?? null,
  knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
  kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
  deployHash: deployHash ?? runtimeIdentity.deployHash ?? null,
  actorUserId: runtimeIdentity.actorUserId ?? null,
});

export const normalizeRuntimeScope = (
  runtimeIdentity?: PersistedRuntimeIdentity | null,
): PersistedRuntimeIdentity | null => {
  if (!runtimeIdentity) {
    return null;
  }
  return buildPersistedRuntimeIdentityPatch(runtimeIdentity);
};
