import {
  IKBSnapshotRepository,
  IModelRepository,
  IViewRepository,
  KBSnapshot,
  KnowledgeBase,
} from '@server/repositories';
import { toPersistedRuntimeIdentityPatch } from './persistedRuntimeIdentity';

type KnowledgeBaseAssetScope = Pick<
  KnowledgeBase,
  'id' | 'workspaceId' | 'defaultKbSnapshotId'
>;

type DefaultSnapshotResolverDeps = {
  kbSnapshotRepository?: Pick<IKBSnapshotRepository, 'findOneBy'>;
};

type AssetCountResolverDeps = DefaultSnapshotResolverDeps & {
  modelRepository?: Pick<IModelRepository, 'findAllByRuntimeIdentity'>;
  viewRepository?: Pick<IViewRepository, 'findAllByRuntimeIdentity'>;
};

export const resolveKnowledgeBaseDefaultSnapshot = async ({
  knowledgeBase,
  defaultSnapshot,
  kbSnapshotRepository,
}: {
  knowledgeBase: KnowledgeBaseAssetScope;
  defaultSnapshot?: KBSnapshot | null;
} & DefaultSnapshotResolverDeps): Promise<KBSnapshot | null> => {
  if (defaultSnapshot !== undefined) {
    return defaultSnapshot;
  }

  if (!knowledgeBase.defaultKbSnapshotId || !kbSnapshotRepository) {
    return null;
  }

  return (
    (await kbSnapshotRepository.findOneBy({
      id: knowledgeBase.defaultKbSnapshotId,
    })) || null
  );
};

export const resolveKnowledgeBaseAssetCount = async ({
  knowledgeBase,
  defaultSnapshot,
  kbSnapshotRepository,
  modelRepository,
  viewRepository,
}: {
  knowledgeBase: KnowledgeBaseAssetScope;
  defaultSnapshot?: KBSnapshot | null;
} & AssetCountResolverDeps): Promise<number> => {
  if (!modelRepository || !viewRepository) {
    return 0;
  }

  const resolvedSnapshot = await resolveKnowledgeBaseDefaultSnapshot({
    knowledgeBase,
    defaultSnapshot,
    kbSnapshotRepository,
  });

  if (!knowledgeBase.workspaceId || !knowledgeBase.id) {
    return 0;
  }

  if (!resolvedSnapshot?.id || !resolvedSnapshot.deployHash) {
    return 0;
  }

  const runtimeIdentity = toPersistedRuntimeIdentityPatch({
    projectId: null,
    workspaceId: knowledgeBase.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
    kbSnapshotId: resolvedSnapshot.id,
    deployHash: resolvedSnapshot.deployHash,
    actorUserId: null,
  });

  const [models, views] = await Promise.all([
    modelRepository.findAllByRuntimeIdentity(runtimeIdentity),
    viewRepository.findAllByRuntimeIdentity(runtimeIdentity),
  ]);

  return models.length + views.length;
};

export const resolveKnowledgeBaseAssetCountMap = async ({
  knowledgeBases,
  kbSnapshotRepository,
  modelRepository,
  viewRepository,
}: {
  knowledgeBases: KnowledgeBaseAssetScope[];
} & AssetCountResolverDeps): Promise<Map<string, number>> => {
  const entries: Array<[string, number]> = await Promise.all(
    knowledgeBases.map(
      async (knowledgeBase) =>
        [
          knowledgeBase.id,
          await resolveKnowledgeBaseAssetCount({
            knowledgeBase,
            kbSnapshotRepository,
            modelRepository,
            viewRepository,
          }),
        ] as [string, number],
    ),
  );

  return new Map(entries);
};
