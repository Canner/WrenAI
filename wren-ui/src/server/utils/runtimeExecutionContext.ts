import { WrenAILanguage } from '@server/models/adaptor';
import {
  PersistedRuntimeIdentity,
  RuntimeScope,
  toPersistedRuntimeIdentity,
} from '@server/context/runtimeScope';
import {
  Deploy,
  IKnowledgeBaseRepository,
  IKBSnapshotRepository,
  KBSnapshot,
  KnowledgeBase,
  Project,
} from '@server/repositories';
import { Manifest } from '@server/mdl/type';
import { normalizeCanonicalPersistedRuntimeIdentity } from './persistedRuntimeIdentity';

export interface QueryExecutionContext {
  project: Project;
  manifest: Manifest;
}

export interface RuntimeExecutionContext extends QueryExecutionContext {
  runtimeIdentity: PersistedRuntimeIdentity;
  project: Project;
  deployment: Deploy;
  manifest: Manifest;
  language: string;
}

export const OUTDATED_RUNTIME_SNAPSHOT_MESSAGE =
  'This snapshot is outdated and cannot be executed';

export const resolveProjectLanguage = (
  project?: Pick<Project, 'language'> | null,
  knowledgeBase?: Pick<KnowledgeBase, 'language'> | null,
): string => {
  const languageKey =
    knowledgeBase?.language ||
    (project?.language && project.language !== 'EN' ? project.language : null);

  if (!languageKey) {
    return WrenAILanguage.ZH_CN;
  }

  if (languageKey in WrenAILanguage) {
    return WrenAILanguage[languageKey as keyof typeof WrenAILanguage];
  }

  return WrenAILanguage.ZH_CN;
};

export const resolveRuntimeSampleDataset = (
  project?: Pick<Project, 'sampleDataset'> | null,
  knowledgeBase?: Pick<KnowledgeBase, 'sampleDataset'> | null,
): string | null =>
  knowledgeBase?.sampleDataset || project?.sampleDataset || null;

const resolveExecutionKnowledgeBase = async ({
  runtimeScope,
  knowledgeBaseRepository,
}: {
  runtimeScope: RuntimeScope;
  knowledgeBaseRepository?: Pick<IKnowledgeBaseRepository, 'findOneBy'>;
}): Promise<KnowledgeBase | null> => {
  if (runtimeScope.knowledgeBase?.id) {
    if (runtimeScope.knowledgeBase.defaultKbSnapshotId !== undefined) {
      return runtimeScope.knowledgeBase;
    }

    if (knowledgeBaseRepository) {
      const knowledgeBase = await knowledgeBaseRepository.findOneBy({
        id: runtimeScope.knowledgeBase.id,
      });
      if (knowledgeBase) {
        return knowledgeBase;
      }
    }
  }

  if (!knowledgeBaseRepository) {
    return null;
  }

  const runtimeProjectId =
    runtimeScope.deployment?.projectId ?? runtimeScope.project?.id ?? null;
  if (!runtimeProjectId) {
    return null;
  }

  return await knowledgeBaseRepository.findOneBy({ runtimeProjectId });
};

const resolveDefaultSnapshotForExecution = async ({
  runtimeScope,
  knowledgeBase,
  kbSnapshotRepository,
}: {
  runtimeScope: RuntimeScope;
  knowledgeBase: Pick<KnowledgeBase, 'defaultKbSnapshotId'>;
  kbSnapshotRepository?: Pick<IKBSnapshotRepository, 'findOneBy'>;
}): Promise<KBSnapshot | null> => {
  if (!knowledgeBase.defaultKbSnapshotId) {
    return null;
  }

  if (
    runtimeScope.kbSnapshot?.id === knowledgeBase.defaultKbSnapshotId &&
    runtimeScope.kbSnapshot.deployHash !== undefined
  ) {
    return runtimeScope.kbSnapshot;
  }

  if (!kbSnapshotRepository) {
    return null;
  }

  return await kbSnapshotRepository.findOneBy({
    id: knowledgeBase.defaultKbSnapshotId,
  });
};

export const assertLatestExecutableRuntimeScope = async ({
  runtimeScope,
  knowledgeBaseRepository,
  kbSnapshotRepository,
}: {
  runtimeScope: RuntimeScope;
  knowledgeBaseRepository?: Pick<IKnowledgeBaseRepository, 'findOneBy'>;
  kbSnapshotRepository?: Pick<IKBSnapshotRepository, 'findOneBy'>;
}): Promise<void> => {
  const knowledgeBase = await resolveExecutionKnowledgeBase({
    runtimeScope,
    knowledgeBaseRepository,
  });
  if (!knowledgeBase?.defaultKbSnapshotId) {
    return;
  }

  const currentKbSnapshotId =
    runtimeScope.kbSnapshot?.id ?? runtimeScope.selector?.kbSnapshotId ?? null;
  if (
    currentKbSnapshotId &&
    currentKbSnapshotId !== knowledgeBase.defaultKbSnapshotId
  ) {
    throw new Error(OUTDATED_RUNTIME_SNAPSHOT_MESSAGE);
  }

  const currentDeployHash =
    runtimeScope.deployHash ??
    runtimeScope.selector?.deployHash ??
    runtimeScope.deployment?.hash ??
    null;
  if (!currentDeployHash) {
    return;
  }

  const defaultSnapshot = await resolveDefaultSnapshotForExecution({
    runtimeScope,
    knowledgeBase,
    kbSnapshotRepository,
  });
  if (!defaultSnapshot?.deployHash) {
    return;
  }

  if (
    !currentKbSnapshotId &&
    currentDeployHash !== defaultSnapshot.deployHash
  ) {
    throw new Error(OUTDATED_RUNTIME_SNAPSHOT_MESSAGE);
  }
};

export const buildRuntimeExecutionContext = (
  runtimeScope: RuntimeScope,
  projectOverride?: Project | null,
): RuntimeExecutionContext | null => {
  const project = projectOverride ?? runtimeScope.project;
  if (!runtimeScope.deployment || !project) {
    return null;
  }

  const runtimeIdentity = normalizeCanonicalPersistedRuntimeIdentity(
    toPersistedRuntimeIdentity(runtimeScope),
  );

  return {
    runtimeIdentity: {
      ...runtimeIdentity,
      deployHash: runtimeIdentity.deployHash || runtimeScope.deployment.hash,
    },
    project,
    deployment: runtimeScope.deployment,
    manifest: runtimeScope.deployment.manifest as Manifest,
    language: resolveProjectLanguage(project, runtimeScope.knowledgeBase),
  };
};

export const getRuntimeProjectBridgeId = (
  runtimeScope: RuntimeScope,
  fallbackBridgeProjectId?: number | null,
): number | null =>
  runtimeScope.deployment?.projectId ??
  runtimeScope.project?.id ??
  runtimeScope.knowledgeBase?.runtimeProjectId ??
  runtimeScope.selector?.bridgeProjectId ??
  fallbackBridgeProjectId ??
  null;

export const resolveRuntimeProject = async (
  runtimeScope: RuntimeScope,
  projectService: Pick<
    { getProjectById: (projectId: number) => Promise<Project> },
    'getProjectById'
  >,
  fallbackBridgeProjectId?: number | null,
): Promise<Project | null> => {
  if (runtimeScope.project?.id) {
    return runtimeScope.project;
  }

  const bridgeProjectId = getRuntimeProjectBridgeId(
    runtimeScope,
    fallbackBridgeProjectId,
  );
  if (!bridgeProjectId) {
    return null;
  }

  return await projectService.getProjectById(bridgeProjectId);
};

export const resolveRuntimeExecutionContext = async ({
  runtimeScope,
  projectService,
}: {
  runtimeScope: RuntimeScope;
  projectService: Pick<
    { getProjectById: (projectId: number) => Promise<Project> },
    'getProjectById'
  >;
}): Promise<RuntimeExecutionContext | null> => {
  const project = await resolveRuntimeProject(runtimeScope, projectService);
  return buildRuntimeExecutionContext(runtimeScope, project);
};
