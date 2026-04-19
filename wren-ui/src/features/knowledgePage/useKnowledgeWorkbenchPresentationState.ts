import buildKnowledgeAssetWorkbenchInputs from './buildKnowledgeAssetWorkbenchInputs';
import buildKnowledgeWorkbenchNavigationStateInputs from './buildKnowledgeWorkbenchNavigationStateInputs';
import useKnowledgeAssetWorkbench from './useKnowledgeAssetWorkbench';
import useKnowledgeWorkbenchNavigationState from './useKnowledgeWorkbenchNavigationState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchPresentationStateArgs } from './knowledgeWorkbenchPresentationStateTypes';

export type { KnowledgeWorkbenchPresentationStateArgs } from './knowledgeWorkbenchPresentationStateTypes';

export function useKnowledgeWorkbenchPresentationState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(args: KnowledgeWorkbenchPresentationStateArgs<TKnowledgeBase, TConnector>) {
  const assetWorkbench = useKnowledgeAssetWorkbench({
    ...buildKnowledgeAssetWorkbenchInputs(args),
  });

  const navigationState = useKnowledgeWorkbenchNavigationState<TKnowledgeBase>({
    ...buildKnowledgeWorkbenchNavigationStateInputs(args),
  });

  return {
    ...assetWorkbench,
    ...navigationState,
  };
}

export default useKnowledgeWorkbenchPresentationState;
