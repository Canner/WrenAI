import buildKnowledgeWorkbenchControllerViewInputs, {
  type KnowledgeWorkbenchControllerViewArgs,
} from './buildKnowledgeWorkbenchControllerViewInputs';
import useKnowledgeWorkbenchViewState from './useKnowledgeWorkbenchViewState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export function useKnowledgeWorkbenchControllerViewState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(args: KnowledgeWorkbenchControllerViewArgs<TKnowledgeBase, TConnector>) {
  return useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>(
    buildKnowledgeWorkbenchControllerViewInputs(args),
  );
}

export default useKnowledgeWorkbenchControllerViewState;
