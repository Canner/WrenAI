import { useEffect } from 'react';

export default function useKnowledgePendingSwitchSync({
  currentKnowledgeBaseId,
  routeKnowledgeBaseId,
  pendingKnowledgeBaseId,
  routeRuntimeSyncing,
  shouldCommitPendingSwitch,
  setSelectedKnowledgeBaseId,
  setPendingKnowledgeBaseId,
}: {
  currentKnowledgeBaseId?: string | null;
  routeKnowledgeBaseId?: string | null;
  pendingKnowledgeBaseId?: string | null;
  routeRuntimeSyncing: boolean;
  shouldCommitPendingSwitch: (args: {
    currentKnowledgeBaseId?: string | null;
    routeKnowledgeBaseId?: string | null;
    pendingKnowledgeBaseId?: string | null;
    routeRuntimeSyncing: boolean;
  }) => boolean;
  setSelectedKnowledgeBaseId: (id: string | null) => void;
  setPendingKnowledgeBaseId: (id: string | null) => void;
}) {
  useEffect(() => {
    if (
      !shouldCommitPendingSwitch({
        currentKnowledgeBaseId,
        routeKnowledgeBaseId,
        pendingKnowledgeBaseId,
        routeRuntimeSyncing,
      })
    ) {
      return;
    }

    setSelectedKnowledgeBaseId(
      routeKnowledgeBaseId || currentKnowledgeBaseId || null,
    );
    setPendingKnowledgeBaseId(null);
  }, [
    currentKnowledgeBaseId,
    pendingKnowledgeBaseId,
    routeKnowledgeBaseId,
    routeRuntimeSyncing,
    setPendingKnowledgeBaseId,
    setSelectedKnowledgeBaseId,
    shouldCommitPendingSwitch,
  ]);
}
