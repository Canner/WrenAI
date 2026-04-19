import { buildKnowledgeWorkbenchControllerOperationsInputs } from './buildKnowledgeWorkbenchControllerInteractionOperationInputs';
import { buildKnowledgeWorkbenchControllerViewStateInputs } from './buildKnowledgeWorkbenchControllerInteractionViewInputs';
import type { KnowledgeWorkbenchControllerInteractionArgs } from './knowledgeWorkbenchControllerInteractionTypes';
import useKnowledgeWorkbenchControllerOperations from './useKnowledgeWorkbenchControllerOperations';
import useKnowledgeWorkbenchControllerViewState from './useKnowledgeWorkbenchControllerViewState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export function useKnowledgeWorkbenchControllerInteractionState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  args: KnowledgeWorkbenchControllerInteractionArgs<TKnowledgeBase, TConnector>,
) {
  const { actions, ruleSqlState } =
    useKnowledgeWorkbenchControllerOperations<TKnowledgeBase>(
      buildKnowledgeWorkbenchControllerOperationsInputs(args),
    );

  const viewState = useKnowledgeWorkbenchControllerViewState<
    TKnowledgeBase,
    TConnector
  >(
    buildKnowledgeWorkbenchControllerViewStateInputs(args, {
      actions,
      ruleSqlState,
    }),
  );

  return {
    actions,
    ruleSqlState,
    viewState,
  };
}

export default useKnowledgeWorkbenchControllerInteractionState;
