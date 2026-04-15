import { useCallback } from 'react';
import useKnowledgeRuntimeSync from './useKnowledgeRuntimeSync';

export const buildKnowledgeRuntimeSyncAction = ({
  refetchRuntimeSelector,
  refetchDiagram,
}: {
  refetchRuntimeSelector: () => Promise<unknown>;
  refetchDiagram: () => Promise<unknown>;
}) => {
  return () => Promise.allSettled([refetchRuntimeSelector(), refetchDiagram()]);
};

export default function useKnowledgeRuntimeDataSync({
  runtimeSyncScopeKey,
  refetchRuntimeSelector,
  refetchDiagram,
}: {
  runtimeSyncScopeKey?: string | null;
  refetchRuntimeSelector: () => Promise<unknown>;
  refetchDiagram: () => Promise<unknown>;
}) {
  const syncKnowledgeRuntimeData = useCallback(
    buildKnowledgeRuntimeSyncAction({
      refetchRuntimeSelector,
      refetchDiagram,
    }),
    [refetchDiagram, refetchRuntimeSelector],
  );

  const { runtimeSyncing: routeRuntimeSyncing } = useKnowledgeRuntimeSync({
    runtimeSyncScopeKey,
    sync: syncKnowledgeRuntimeData,
  });

  return {
    routeRuntimeSyncing,
  };
}
