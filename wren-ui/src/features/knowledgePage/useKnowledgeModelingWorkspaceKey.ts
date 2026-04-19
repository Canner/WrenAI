import { useEffect, useMemo, useState } from 'react';

export const buildKnowledgeModelingWorkspaceKey = ({
  activeKnowledgeBaseId,
  activeKnowledgeSnapshotId,
  deployHash,
}: {
  activeKnowledgeBaseId?: string | null;
  activeKnowledgeSnapshotId?: string | null;
  deployHash?: string | null;
}) =>
  `${activeKnowledgeBaseId || 'none'}:${activeKnowledgeSnapshotId || 'default'}:${deployHash || 'deploy'}`;

export const resolveCommittedKnowledgeModelingWorkspaceKey = ({
  currentKey,
  previousKey,
  routeRuntimeSyncing,
}: {
  currentKey: string;
  previousKey: string;
  routeRuntimeSyncing: boolean;
}) => {
  if (routeRuntimeSyncing || previousKey === currentKey) {
    return previousKey;
  }

  return currentKey;
};

export function useKnowledgeModelingWorkspaceKey({
  activeKnowledgeBaseId,
  activeKnowledgeSnapshotId,
  deployHash,
  routeRuntimeSyncing,
}: {
  activeKnowledgeBaseId?: string | null;
  activeKnowledgeSnapshotId?: string | null;
  deployHash?: string | null;
  routeRuntimeSyncing: boolean;
}) {
  const currentModelingWorkspaceKey = useMemo(
    () =>
      buildKnowledgeModelingWorkspaceKey({
        activeKnowledgeBaseId,
        activeKnowledgeSnapshotId,
        deployHash,
      }),
    [activeKnowledgeBaseId, activeKnowledgeSnapshotId, deployHash],
  );
  const [committedModelingWorkspaceKey, setCommittedModelingWorkspaceKey] =
    useState(currentModelingWorkspaceKey);

  useEffect(() => {
    setCommittedModelingWorkspaceKey((previousKey) =>
      resolveCommittedKnowledgeModelingWorkspaceKey({
        currentKey: currentModelingWorkspaceKey,
        previousKey,
        routeRuntimeSyncing,
      }),
    );
  }, [currentModelingWorkspaceKey, routeRuntimeSyncing]);

  return committedModelingWorkspaceKey;
}

export default useKnowledgeModelingWorkspaceKey;
