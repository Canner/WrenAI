import buildKnowledgeWorkbenchPresentationStateInputs from './buildKnowledgeWorkbenchPresentationStateInputs';
import buildKnowledgeWorkbenchSyncEffectsInputs from './buildKnowledgeWorkbenchSyncEffectsInputs';
import useKnowledgeWorkbenchPresentationState from './useKnowledgeWorkbenchPresentationState';
import useKnowledgeWorkbenchSyncEffects from './useKnowledgeWorkbenchSyncEffects';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchViewStateArgs } from './knowledgeWorkbenchViewStateTypes';

export type { KnowledgeWorkbenchViewStateArgs } from './knowledgeWorkbenchViewStateTypes';

export function useKnowledgeWorkbenchViewState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(args: KnowledgeWorkbenchViewStateArgs<TKnowledgeBase, TConnector>) {
  const presentationState = useKnowledgeWorkbenchPresentationState<
    TKnowledgeBase,
    TConnector
  >(buildKnowledgeWorkbenchPresentationStateInputs(args));

  useKnowledgeWorkbenchSyncEffects(
    buildKnowledgeWorkbenchSyncEffectsInputs(args),
  );

  return presentationState;
}

export default useKnowledgeWorkbenchViewState;
