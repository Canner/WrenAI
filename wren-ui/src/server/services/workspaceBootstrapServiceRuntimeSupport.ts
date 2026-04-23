import crypto from 'crypto';
import { Deploy, KBSnapshot, KnowledgeBase } from '../repositories';
import { SampleDatasetName } from '@server/data';
import {
  WorkspaceBootstrapRuntimeDeps,
  WorkspaceBootstrapServiceDependencies,
} from './workspaceBootstrapServiceTypes';
import {
  SYSTEM_SAMPLE_SNAPSHOT_KEY,
  SYSTEM_SAMPLE_SNAPSHOT_STATUS,
} from './workspaceBootstrapServiceSupport';

const PRIMARY_SYSTEM_SAMPLE_DATASET = 'ECOMMERCE' as SampleDatasetName;

export const resolveExistingSampleDeployment = async (
  knowledgeBase: KnowledgeBase,
  deps: WorkspaceBootstrapServiceDependencies,
): Promise<Deploy | null> => {
  const snapshot = await findSystemSampleSnapshot(knowledgeBase, deps);

  if (snapshot?.deployHash) {
    const deployment = await deps.deployService.getDeploymentByRuntimeIdentity({
      workspaceId: knowledgeBase.workspaceId,
      knowledgeBaseId: knowledgeBase.id,
      kbSnapshotId: snapshot.id,
      deployHash: snapshot.deployHash,
      projectId: null,
    });
    if (deployment && (await projectExists(deployment.projectId, deps))) {
      return deployment;
    }
  }

  const fallbackDeployment =
    await deps.deployService.getLastDeploymentByRuntimeIdentity({
      workspaceId: knowledgeBase.workspaceId,
      knowledgeBaseId: knowledgeBase.id,
      kbSnapshotId: snapshot?.id || null,
      deployHash: null,
      projectId: null,
    });

  if (!fallbackDeployment) {
    return null;
  }

  return (await projectExists(fallbackDeployment.projectId, deps))
    ? fallbackDeployment
    : null;
};

export const ensureSystemSampleSnapshot = async (
  knowledgeBase: KnowledgeBase,
  deployment: Deploy,
  deps: WorkspaceBootstrapServiceDependencies,
): Promise<KBSnapshot> => {
  const snapshot = await findSystemSampleSnapshot(knowledgeBase, deps);
  const displayName = `${knowledgeBase.name} 默认快照`;

  const upsertedSnapshot = snapshot
    ? await deps.kbSnapshotRepository.updateOne(snapshot.id, {
        displayName,
        deployHash: deployment.hash,
        status: SYSTEM_SAMPLE_SNAPSHOT_STATUS,
        manifestRef: null,
      })
    : await deps.kbSnapshotRepository.createOne({
        id: crypto.randomUUID(),
        knowledgeBaseId: knowledgeBase.id,
        snapshotKey: SYSTEM_SAMPLE_SNAPSHOT_KEY,
        displayName,
        environment: null,
        versionLabel: null,
        deployHash: deployment.hash,
        manifestRef: null,
        status: SYSTEM_SAMPLE_SNAPSHOT_STATUS,
      });

  if (deployment.kbSnapshotId !== upsertedSnapshot.id) {
    await deps.deployLogRepository.updateOne(deployment.id, {
      kbSnapshotId: upsertedSnapshot.id,
    });
  }

  return upsertedSnapshot;
};

export const syncSystemSampleKnowledgeBase = async (
  knowledgeBase: KnowledgeBase,
  snapshot: KBSnapshot,
  deps: WorkspaceBootstrapServiceDependencies,
): Promise<void> => {
  const shouldUpdate =
    knowledgeBase.defaultKbSnapshotId !== snapshot.id ||
    knowledgeBase.primaryConnectorId !== null;

  if (!shouldUpdate) {
    return;
  }

  await deps.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
    defaultKbSnapshotId: snapshot.id,
    primaryConnectorId: null,
  });
};

export const syncRuntimeScopedArtifacts = async (
  knowledgeBase: KnowledgeBase,
  snapshot: KBSnapshot,
  deployment: Deploy,
  deps: WorkspaceBootstrapServiceDependencies,
): Promise<void> => {
  const models = await deps.modelRepository.findAllBy({
    projectId: deployment.projectId,
  });
  for (const model of models) {
    const shouldUpdate =
      model.workspaceId !== knowledgeBase.workspaceId ||
      model.knowledgeBaseId !== knowledgeBase.id ||
      model.kbSnapshotId !== snapshot.id ||
      model.deployHash !== deployment.hash;

    if (!shouldUpdate) {
      continue;
    }

    await deps.modelRepository.updateOne(model.id, {
      workspaceId: knowledgeBase.workspaceId,
      knowledgeBaseId: knowledgeBase.id,
      kbSnapshotId: snapshot.id,
      deployHash: deployment.hash,
      actorUserId: null,
    });
  }

  const relations = await deps.relationRepository.findAllBy({
    projectId: deployment.projectId,
  });
  for (const relation of relations) {
    const shouldUpdate =
      relation.workspaceId !== knowledgeBase.workspaceId ||
      relation.knowledgeBaseId !== knowledgeBase.id ||
      relation.kbSnapshotId !== snapshot.id ||
      relation.deployHash !== deployment.hash;

    if (!shouldUpdate) {
      continue;
    }

    await deps.relationRepository.updateOne(relation.id, {
      workspaceId: knowledgeBase.workspaceId,
      knowledgeBaseId: knowledgeBase.id,
      kbSnapshotId: snapshot.id,
      deployHash: deployment.hash,
      actorUserId: null,
    });
  }
};

export const findSystemSampleSnapshot = async (
  knowledgeBase: KnowledgeBase,
  deps: WorkspaceBootstrapServiceDependencies,
): Promise<KBSnapshot | null> =>
  await deps.kbSnapshotRepository.findOneBy({
    knowledgeBaseId: knowledgeBase.id,
    snapshotKey: SYSTEM_SAMPLE_SNAPSHOT_KEY,
  });

export const pickPrimarySystemSampleKnowledgeBase = (
  knowledgeBases: KnowledgeBase[],
): KnowledgeBase | null => {
  if (knowledgeBases.length === 0) {
    return null;
  }

  return (
    knowledgeBases.find(
      (knowledgeBase) =>
        knowledgeBase.sampleDataset === PRIMARY_SYSTEM_SAMPLE_DATASET,
    ) || sortSystemSampleKnowledgeBasesForSeeding(knowledgeBases)[0]
  );
};

export const sortSystemSampleKnowledgeBasesForSeeding = (
  knowledgeBases: KnowledgeBase[],
) =>
  [...knowledgeBases].sort((left, right) => {
    const leftPriority =
      left.sampleDataset === PRIMARY_SYSTEM_SAMPLE_DATASET ? 0 : 1;
    const rightPriority =
      right.sampleDataset === PRIMARY_SYSTEM_SAMPLE_DATASET ? 0 : 1;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return String(left.name || '').localeCompare(String(right.name || ''));
  });

export const warmSystemSampleRuntimesInBackground = (
  workspaceId: string,
  knowledgeBases: KnowledgeBase[],
  eagerKnowledgeBaseId: string | null,
  deps: WorkspaceBootstrapRuntimeDeps,
  logger: { warn: (message: string) => void },
  ensureSystemSampleRuntime: (knowledgeBase: KnowledgeBase) => Promise<void>,
) => {
  const remainingKnowledgeBases = sortSystemSampleKnowledgeBasesForSeeding(
    knowledgeBases,
  ).filter((knowledgeBase) => knowledgeBase.id !== eagerKnowledgeBaseId);

  if (
    remainingKnowledgeBases.length === 0 ||
    deps.workspaceWarmupJobs.has(workspaceId)
  ) {
    return;
  }

  const job = (async () => {
    for (const knowledgeBase of remainingKnowledgeBases) {
      try {
        await ensureSystemSampleRuntime(knowledgeBase);
      } catch (error: any) {
        logger.warn(
          `Background bootstrap skipped for sample knowledge base ${knowledgeBase.id}: ${
            error?.message || error
          }`,
        );
      }
    }
  })().finally(() => {
    deps.workspaceWarmupJobs.delete(workspaceId);
  });

  deps.workspaceWarmupJobs.set(workspaceId, job);
};

export const projectExists = async (
  projectId: number,
  deps: WorkspaceBootstrapServiceDependencies,
): Promise<boolean> => {
  if (!projectId) {
    return false;
  }

  const project = await deps.projectRepository.findOneBy({ id: projectId });
  return Boolean(project);
};
