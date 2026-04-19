import useKnowledgeWorkbenchContentData from './useKnowledgeWorkbenchContentData';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerDataStateArgs } from './knowledgeWorkbenchControllerDataStateTypes';
import type { KnowledgeWorkbenchControllerDataKnowledgeState } from './knowledgeWorkbenchControllerDataStateTypes';

export function buildKnowledgeWorkbenchContentDataInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  {
    assetModalOpen,
    draftAssets,
    hasRuntimeScope,
    runtimeTransitioning,
  }: KnowledgeWorkbenchControllerDataStateArgs<TKnowledgeBase, TConnector>,
  knowledgeState: KnowledgeWorkbenchControllerDataKnowledgeState<
    TKnowledgeBase,
    TConnector
  >,
): Parameters<
  typeof useKnowledgeWorkbenchContentData<TKnowledgeBase, TConnector>
>[0] {
  return {
    activeKnowledgeBase: knowledgeState.activeKnowledgeBase,
    activeKnowledgeBaseExecutable: knowledgeState.activeKnowledgeBaseExecutable,
    activeKnowledgeRuntimeSelector:
      knowledgeState.activeKnowledgeRuntimeSelector,
    activeKnowledgeSnapshotId: knowledgeState.activeKnowledgeSnapshotId,
    assetModalOpen,
    draftAssets,
    fetchConnectors: knowledgeState.fetchConnectors,
    handleConnectorLoadError: knowledgeState.handleConnectorLoadError,
    hasRuntimeScope,
    initialKnowledgeSourceType: knowledgeState.initialKnowledgeSourceType,
    knowledgeOwner: knowledgeState.knowledgeOwner,
    knowledgeSourceOptions: knowledgeState.knowledgeSourceOptions,
    matchedDemoKnowledge: knowledgeState.matchedDemoKnowledge,
    refetchRuntimeSelector: knowledgeState.refetchRuntimeSelector,
    runtimeSyncScopeKey: knowledgeState.runtimeSyncScopeKey,
    runtimeTransitioning,
  };
}

export default buildKnowledgeWorkbenchContentDataInputs;
