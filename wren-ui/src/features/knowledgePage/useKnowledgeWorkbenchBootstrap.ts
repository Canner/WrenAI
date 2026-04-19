import { useEffect } from 'react';

export const shouldBootstrapKnowledgeRuleSqlLists = ({
  activeKnowledgeBaseId,
  hasRuntimeScope,
  routeRuntimeSyncing,
}: {
  activeKnowledgeBaseId?: string | null;
  hasRuntimeScope: boolean;
  routeRuntimeSyncing: boolean;
}) => Boolean(activeKnowledgeBaseId && hasRuntimeScope && !routeRuntimeSyncing);

export function useKnowledgeWorkbenchBootstrap({
  activeKnowledgeBaseId,
  activeKnowledgeSnapshotId,
  hasRuntimeScope,
  loadRuleList,
  loadSqlList,
  routeRuntimeSyncing,
}: {
  activeKnowledgeBaseId?: string | null;
  activeKnowledgeSnapshotId?: string | null;
  hasRuntimeScope: boolean;
  loadRuleList: () => Promise<unknown>;
  loadSqlList: () => Promise<unknown>;
  routeRuntimeSyncing: boolean;
}) {
  useEffect(() => {
    if (
      !shouldBootstrapKnowledgeRuleSqlLists({
        activeKnowledgeBaseId,
        hasRuntimeScope,
        routeRuntimeSyncing,
      })
    ) {
      return;
    }

    void loadRuleList().catch(() => null);
    void loadSqlList().catch(() => null);
  }, [
    activeKnowledgeBaseId,
    activeKnowledgeSnapshotId,
    hasRuntimeScope,
    loadRuleList,
    loadSqlList,
    routeRuntimeSyncing,
  ]);
}

export default useKnowledgeWorkbenchBootstrap;
