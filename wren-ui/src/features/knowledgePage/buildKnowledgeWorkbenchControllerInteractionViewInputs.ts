import useKnowledgeWorkbenchControllerOperations from './useKnowledgeWorkbenchControllerOperations';
import useKnowledgeWorkbenchControllerViewState from './useKnowledgeWorkbenchControllerViewState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerInteractionArgs } from './knowledgeWorkbenchControllerInteractionTypes';

export function buildKnowledgeWorkbenchControllerViewStateInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  args: KnowledgeWorkbenchControllerInteractionArgs<TKnowledgeBase, TConnector>,
  operationsResult: Pick<
    ReturnType<
      typeof useKnowledgeWorkbenchControllerOperations<TKnowledgeBase>
    >,
    'actions' | 'ruleSqlState'
  >,
): Parameters<
  typeof useKnowledgeWorkbenchControllerViewState<TKnowledgeBase, TConnector>
>[0] {
  return {
    ...args,
    actions: operationsResult.actions,
    ruleSqlState: operationsResult.ruleSqlState,
  };
}

export default buildKnowledgeWorkbenchControllerViewStateInputs;
