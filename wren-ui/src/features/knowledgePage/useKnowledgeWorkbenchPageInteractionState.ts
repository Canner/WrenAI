import buildKnowledgeWorkbenchPageInteractionInputs, {
  type KnowledgeWorkbenchPageInteractionArgs,
} from './buildKnowledgeWorkbenchPageInteractionInputs';
import useKnowledgeWorkbenchControllerInteractionState from './useKnowledgeWorkbenchControllerInteractionState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export function useKnowledgeWorkbenchPageInteractionState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(args: KnowledgeWorkbenchPageInteractionArgs<TKnowledgeBase, TConnector>) {
  return useKnowledgeWorkbenchControllerInteractionState<
    TKnowledgeBase,
    TConnector
  >(buildKnowledgeWorkbenchPageInteractionInputs(args));
}

export default useKnowledgeWorkbenchPageInteractionState;
