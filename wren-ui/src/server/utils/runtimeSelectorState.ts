import {
  IDeployLogRepository,
  IKBSnapshotRepository,
  KBSnapshot,
  KnowledgeBase,
} from '@server/repositories';

export const sortByName = <T extends { name?: string | null }>(items: T[]) =>
  [...items].sort((left, right) =>
    String(left.name || '').localeCompare(String(right.name || '')),
  );

export const sortByDisplayName = <T extends { displayName?: string | null }>(
  items: T[],
) =>
  [...items].sort((left, right) =>
    String(left.displayName || '').localeCompare(
      String(right.displayName || ''),
    ),
  );

const isActiveSnapshot = (snapshot: KBSnapshot | null | undefined) =>
  snapshot?.status === 'active';

const resolveExecutableSnapshotIds = async ({
  snapshots,
  deployLogRepository,
}: {
  snapshots: KBSnapshot[];
  deployLogRepository?:
    | Pick<IDeployLogRepository, 'findLastRuntimeDeployLog'>
    | null;
}) => {
  if (!deployLogRepository || snapshots.length === 0) {
    return null;
  }

  const executableSnapshotIds = await Promise.all(
    snapshots.map(async (snapshot) => {
      const deployment = await deployLogRepository.findLastRuntimeDeployLog({
        workspaceId: null,
        knowledgeBaseId: snapshot.knowledgeBaseId || null,
        kbSnapshotId: snapshot.id,
        projectId: null,
        deployHash: null,
      });

      return deployment ? snapshot.id : null;
    }),
  );

  return new Set(
    executableSnapshotIds.filter(
      (snapshotId): snapshotId is string => Boolean(snapshotId),
    ),
  );
};

const isExecutableSnapshot = (
  snapshot: KBSnapshot | null | undefined,
  executableSnapshotIds?: Set<string> | null,
) => {
  if (!isActiveSnapshot(snapshot)) {
    return false;
  }

  if (!snapshot?.id) {
    return false;
  }

  if (!executableSnapshotIds) {
    return true;
  }

  return executableSnapshotIds.has(snapshot.id);
};

const pickPreferredSnapshot = ({
  defaultSnapshot,
  snapshots,
  executableSnapshotIds,
}: {
  defaultSnapshot: KBSnapshot | null;
  snapshots: KBSnapshot[];
  executableSnapshotIds?: Set<string> | null;
}) => {
  const activeSnapshots = sortByDisplayName(
    snapshots.filter((snapshot) =>
      isExecutableSnapshot(snapshot, executableSnapshotIds),
    ),
  );

  if (isExecutableSnapshot(defaultSnapshot, executableSnapshotIds)) {
    return defaultSnapshot;
  }

  if (executableSnapshotIds) {
    return activeSnapshots[0] || null;
  }

  return activeSnapshots[0] || defaultSnapshot || null;
};

export const resolveKnowledgeBaseSnapshotSelection = async ({
  knowledgeBase,
  kbSnapshotRepository,
  deployLogRepository,
}: {
  knowledgeBase: KnowledgeBase | null;
  kbSnapshotRepository: IKBSnapshotRepository;
  deployLogRepository?:
    | Pick<IDeployLogRepository, 'findLastRuntimeDeployLog'>
    | null;
}) => {
  if (!knowledgeBase) {
    return {
      snapshot: null,
      snapshots: [] as KBSnapshot[],
    };
  }

  const snapshots = await kbSnapshotRepository.findAllBy({
    knowledgeBaseId: knowledgeBase.id,
  });
  const defaultSnapshot = knowledgeBase.defaultKbSnapshotId
    ? snapshots.find(
        (snapshot) => snapshot.id === knowledgeBase.defaultKbSnapshotId,
      ) ||
      (await kbSnapshotRepository.findOneBy({
        id: knowledgeBase.defaultKbSnapshotId,
      })) ||
      null
    : null;
  const executableSnapshotIds = await resolveExecutableSnapshotIds({
    snapshots: snapshots.filter((snapshot) => isActiveSnapshot(snapshot)),
    deployLogRepository,
  });

  return {
    snapshot: pickPreferredSnapshot({
      defaultSnapshot,
      snapshots,
      executableSnapshotIds,
    }),
    snapshots,
  };
};

export const resolveBootstrapKnowledgeBaseSelection = async (
  knowledgeBases: KnowledgeBase[],
  kbSnapshotRepository: IKBSnapshotRepository,
  deployLogRepository?:
    | Pick<IDeployLogRepository, 'findLastRuntimeDeployLog'>
    | null,
) => {
  const sortedKnowledgeBases = sortByName(
    knowledgeBases.filter((knowledgeBase) => !knowledgeBase.archivedAt),
  );

  let fallbackKnowledgeBase: KnowledgeBase | null = null;
  let fallbackSnapshot: KBSnapshot | null = null;

  for (const knowledgeBase of sortedKnowledgeBases) {
    const { snapshot } = await resolveKnowledgeBaseSnapshotSelection({
      knowledgeBase,
      kbSnapshotRepository,
      deployLogRepository,
    });

    if (!fallbackKnowledgeBase) {
      fallbackKnowledgeBase = knowledgeBase;
      fallbackSnapshot = snapshot;
    }

    if (snapshot) {
      return {
        knowledgeBase,
        snapshot,
      };
    }
  }

  return {
    knowledgeBase: fallbackKnowledgeBase,
    snapshot: fallbackSnapshot,
  };
};
