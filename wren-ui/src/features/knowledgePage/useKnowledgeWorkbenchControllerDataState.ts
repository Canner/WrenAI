import buildKnowledgeWorkbenchContentDataInputs from './buildKnowledgeWorkbenchContentDataInputs';
import buildKnowledgeWorkbenchKnowledgeStateInputs from './buildKnowledgeWorkbenchKnowledgeStateInputs';
import buildKnowledgeWorkbenchModelingStateInputs from './buildKnowledgeWorkbenchModelingStateInputs';
import useKnowledgeWorkbenchContentData from './useKnowledgeWorkbenchContentData';
import useKnowledgeWorkbenchKnowledgeState from './useKnowledgeWorkbenchKnowledgeState';
import useKnowledgeWorkbenchModelingState from './useKnowledgeWorkbenchModelingState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerDataStateArgs } from './knowledgeWorkbenchControllerDataStateTypes';

export function useKnowledgeWorkbenchControllerDataState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(args: KnowledgeWorkbenchControllerDataStateArgs<TKnowledgeBase, TConnector>) {
  const knowledgeState = useKnowledgeWorkbenchKnowledgeState<
    TKnowledgeBase,
    TConnector
  >(buildKnowledgeWorkbenchKnowledgeStateInputs(args));

  const contentData = useKnowledgeWorkbenchContentData<
    TKnowledgeBase,
    TConnector
  >(buildKnowledgeWorkbenchContentDataInputs(args, knowledgeState));

  const modelingState = useKnowledgeWorkbenchModelingState(
    buildKnowledgeWorkbenchModelingStateInputs(knowledgeState, contentData),
  );

  return {
    contentData,
    knowledgeState,
    modelingState,
  };
}

export default useKnowledgeWorkbenchControllerDataState;
