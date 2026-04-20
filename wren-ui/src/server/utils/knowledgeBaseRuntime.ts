import crypto from 'crypto';
import {
  Deploy,
  IDeployLogRepository,
  IKBSnapshotRepository,
  IKnowledgeBaseRepository,
  KnowledgeBase,
  KBSnapshot,
  Model,
  Relation,
  View,
} from '@server/repositories';
import { IDeployService } from '@server/services';

export const LATEST_EXECUTABLE_KB_SNAPSHOT_KEY = 'latest-executable-default';
export const LATEST_EXECUTABLE_KB_SNAPSHOT_STATUS = 'active';

type RuntimeScopedRepository<T extends { id: number | string }> = {
  findAllBy(filter: Partial<T>): Promise<T[]>;
  updateOne(id: T['id'], patch: Partial<T>): Promise<T>;
};

const buildSnapshotDisplayName = (knowledgeBase: KnowledgeBase) =>
  `${knowledgeBase.name} 默认快照`;

const resolveExistingSnapshot = async ({
  knowledgeBase,
  kbSnapshotRepository,
}: {
  knowledgeBase: KnowledgeBase;
  kbSnapshotRepository: Pick<IKBSnapshotRepository, 'findOneBy'>;
}): Promise<KBSnapshot | null> => {
  const managedSnapshot = await kbSnapshotRepository.findOneBy({
    knowledgeBaseId: knowledgeBase.id,
    snapshotKey: LATEST_EXECUTABLE_KB_SNAPSHOT_KEY,
  });

  if (managedSnapshot) {
    return managedSnapshot;
  }

  if (!knowledgeBase.defaultKbSnapshotId) {
    return null;
  }

  const defaultSnapshot = await kbSnapshotRepository.findOneBy({
    id: knowledgeBase.defaultKbSnapshotId,
  });
  if (
    defaultSnapshot &&
    defaultSnapshot.knowledgeBaseId === knowledgeBase.id &&
    defaultSnapshot.snapshotKey === LATEST_EXECUTABLE_KB_SNAPSHOT_KEY
  ) {
    return defaultSnapshot;
  }

  return null;
};

const syncProjectRuntimeArtifacts = async <
  T extends {
    id: number | string;
    projectId?: number | null;
    workspaceId?: string | null;
    knowledgeBaseId?: string | null;
    kbSnapshotId?: string | null;
    deployHash?: string | null;
  },
>({
  repository,
  deployment,
  knowledgeBase,
  snapshot,
}: {
  repository?: RuntimeScopedRepository<T>;
  deployment: Pick<Deploy, 'projectId' | 'hash'>;
  knowledgeBase: Pick<KnowledgeBase, 'id' | 'workspaceId'>;
  snapshot: Pick<KBSnapshot, 'id'>;
}) => {
  if (!repository) {
    return;
  }

  const runtimeScopedRecords = await Promise.all([
    deployment.projectId != null
      ? repository.findAllBy({
          projectId: deployment.projectId,
        } as Partial<T>)
      : Promise.resolve([] as T[]),
    knowledgeBase.id
      ? repository.findAllBy({
          knowledgeBaseId: knowledgeBase.id,
        } as Partial<T>)
      : Promise.resolve([] as T[]),
  ]);

  const records = [
    ...new Map(
      runtimeScopedRecords
        .flat()
        .map((record) => [record.id, record] as const),
    ).values(),
  ];

  for (const record of records) {
    const shouldUpdate =
      record.workspaceId !== knowledgeBase.workspaceId ||
      record.knowledgeBaseId !== knowledgeBase.id ||
      record.kbSnapshotId !== snapshot.id ||
      record.deployHash !== deployment.hash;

    if (!shouldUpdate) {
      continue;
    }

    await repository.updateOne(record.id, {
      workspaceId: knowledgeBase.workspaceId,
      knowledgeBaseId: knowledgeBase.id,
      kbSnapshotId: snapshot.id,
      deployHash: deployment.hash,
    } as Partial<T>);
  }
};

export const syncLatestExecutableKnowledgeBaseSnapshot = async ({
  knowledgeBase,
  knowledgeBaseRepository,
  kbSnapshotRepository,
  deployLogRepository,
  deployService,
  modelRepository,
  relationRepository,
  viewRepository,
}: {
  knowledgeBase: KnowledgeBase | null;
  knowledgeBaseRepository: Pick<IKnowledgeBaseRepository, 'updateOne'>;
  kbSnapshotRepository: Pick<
    IKBSnapshotRepository,
    'findOneBy' | 'createOne' | 'updateOne'
  >;
  deployLogRepository: Pick<IDeployLogRepository, 'updateOne'>;
  deployService: Pick<IDeployService, 'getLastDeploymentByRuntimeIdentity'>;
  modelRepository?: RuntimeScopedRepository<Model>;
  relationRepository?: RuntimeScopedRepository<Relation>;
  viewRepository?: RuntimeScopedRepository<View>;
}): Promise<KBSnapshot | null> => {
  if (!knowledgeBase?.workspaceId || !knowledgeBase.id) {
    return null;
  }

  const deployment = await deployService.getLastDeploymentByRuntimeIdentity({
    projectId: null,
    workspaceId: knowledgeBase.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
    kbSnapshotId: null,
    deployHash: null,
  });

  if (!deployment) {
    return null;
  }

  const existingSnapshot = await resolveExistingSnapshot({
    knowledgeBase,
    kbSnapshotRepository,
  });
  const displayName = buildSnapshotDisplayName(knowledgeBase);
  const snapshot = existingSnapshot
    ? await kbSnapshotRepository.updateOne(existingSnapshot.id, {
        displayName,
        deployHash: deployment.hash,
        status: LATEST_EXECUTABLE_KB_SNAPSHOT_STATUS,
        manifestRef: null,
      })
    : await kbSnapshotRepository.createOne({
        id: crypto.randomUUID(),
        knowledgeBaseId: knowledgeBase.id,
        snapshotKey: LATEST_EXECUTABLE_KB_SNAPSHOT_KEY,
        displayName,
        environment: null,
        versionLabel: null,
        deployHash: deployment.hash,
        manifestRef: null,
        status: LATEST_EXECUTABLE_KB_SNAPSHOT_STATUS,
      });

  if (deployment.kbSnapshotId !== snapshot.id) {
    await deployLogRepository.updateOne(deployment.id, {
      kbSnapshotId: snapshot.id,
    });
  }

  if (knowledgeBase.defaultKbSnapshotId !== snapshot.id) {
    await knowledgeBaseRepository.updateOne(knowledgeBase.id, {
      defaultKbSnapshotId: snapshot.id,
    });
  }

  await Promise.all([
    syncProjectRuntimeArtifacts({
      repository: modelRepository,
      deployment,
      knowledgeBase,
      snapshot,
    }),
    syncProjectRuntimeArtifacts({
      repository: relationRepository,
      deployment,
      knowledgeBase,
      snapshot,
    }),
    syncProjectRuntimeArtifacts({
      repository: viewRepository,
      deployment,
      knowledgeBase,
      snapshot,
    }),
  ]);

  return snapshot;
};
