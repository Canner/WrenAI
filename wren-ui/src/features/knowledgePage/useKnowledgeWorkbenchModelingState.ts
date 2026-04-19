import { useMemo } from 'react';
import useKnowledgeModelingWorkspaceKey from './useKnowledgeModelingWorkspaceKey';
import { buildKnowledgeModelingSummary } from './sections/buildKnowledgeModelingSummary';

export function useKnowledgeWorkbenchModelingState({
  activeKnowledgeBaseId,
  activeKnowledgeSnapshotId,
  deployHash,
  diagramData,
  routeRuntimeSyncing,
}: {
  activeKnowledgeBaseId?: string | null;
  activeKnowledgeSnapshotId?: string | null;
  deployHash?: string | null;
  diagramData?: {
    diagram?: Parameters<typeof buildKnowledgeModelingSummary>[0];
  } | null;
  routeRuntimeSyncing: boolean;
}) {
  const modelingSummary = useMemo(
    () => buildKnowledgeModelingSummary(diagramData?.diagram),
    [diagramData],
  );

  const committedModelingWorkspaceKey = useKnowledgeModelingWorkspaceKey({
    activeKnowledgeBaseId,
    activeKnowledgeSnapshotId,
    deployHash,
    routeRuntimeSyncing,
  });

  return {
    committedModelingWorkspaceKey,
    modelingSummary,
  };
}

export default useKnowledgeWorkbenchModelingState;
