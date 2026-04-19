import useKnowledgeWorkbenchViewState from './useKnowledgeWorkbenchViewState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerViewArgs } from './knowledgeWorkbenchControllerViewTypes';

export type { KnowledgeWorkbenchControllerViewArgs } from './knowledgeWorkbenchControllerViewTypes';

export function buildKnowledgeWorkbenchControllerViewInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  actions,
  ruleSqlState,
  routeRuntimeSyncing,
  ...rest
}: KnowledgeWorkbenchControllerViewArgs<
  TKnowledgeBase,
  TConnector
>): Parameters<
  typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
>[0] {
  const { buildKnowledgeRuntimeSelector, openAssetWizard } = actions;
  const { loadRuleList, loadSqlList, resetRuleSqlManagerState } = ruleSqlState;

  return {
    ...rest,
    buildKnowledgeRuntimeSelector,
    loadRuleList,
    loadSqlList,
    openAssetWizard,
    refetchReady: !routeRuntimeSyncing,
    resetRuleSqlManagerState,
    routeRuntimeSyncing,
  };
}

export default buildKnowledgeWorkbenchControllerViewInputs;
