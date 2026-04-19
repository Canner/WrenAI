import useKnowledgeWorkbenchModelingState from './useKnowledgeWorkbenchModelingState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerDataContentState } from './knowledgeWorkbenchControllerDataStateTypes';
import type { KnowledgeWorkbenchControllerDataKnowledgeState } from './knowledgeWorkbenchControllerDataStateTypes';

export function buildKnowledgeWorkbenchModelingStateInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  knowledgeState: KnowledgeWorkbenchControllerDataKnowledgeState<
    TKnowledgeBase,
    TConnector
  >,
  contentData: KnowledgeWorkbenchControllerDataContentState<
    TKnowledgeBase,
    TConnector
  >,
): Parameters<typeof useKnowledgeWorkbenchModelingState>[0] {
  return {
    activeKnowledgeBaseId: knowledgeState.activeKnowledgeBase?.id,
    activeKnowledgeSnapshotId: knowledgeState.activeKnowledgeSnapshotId,
    deployHash:
      knowledgeState.runtimeSelectorState?.currentKbSnapshot?.deployHash,
    diagramData: contentData.diagramData,
    routeRuntimeSyncing: contentData.routeRuntimeSyncing,
  };
}

export default buildKnowledgeWorkbenchModelingStateInputs;
