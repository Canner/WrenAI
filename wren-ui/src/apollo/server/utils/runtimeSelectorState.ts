import {
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

const pickPreferredSnapshot = ({
  defaultSnapshot,
  snapshots,
}: {
  defaultSnapshot: KBSnapshot | null;
  snapshots: KBSnapshot[];
}) => {
  const activeSnapshots = sortByDisplayName(
    snapshots.filter((snapshot) => isActiveSnapshot(snapshot)),
  );

  if (isActiveSnapshot(defaultSnapshot)) {
    return defaultSnapshot;
  }

  return activeSnapshots[0] || defaultSnapshot || null;
};

export const resolveKnowledgeBaseSnapshotSelection = async ({
  knowledgeBase,
  kbSnapshotRepository,
}: {
  knowledgeBase: KnowledgeBase | null;
  kbSnapshotRepository: IKBSnapshotRepository;
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

  return {
    snapshot: pickPreferredSnapshot({
      defaultSnapshot,
      snapshots,
    }),
    snapshots,
  };
};

export const resolveBootstrapKnowledgeBaseSelection = async (
  knowledgeBases: KnowledgeBase[],
  kbSnapshotRepository: IKBSnapshotRepository,
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
