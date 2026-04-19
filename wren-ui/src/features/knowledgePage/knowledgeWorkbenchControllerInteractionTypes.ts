import useKnowledgeWorkbenchControllerOperations from './useKnowledgeWorkbenchControllerOperations';
import useKnowledgeWorkbenchControllerViewState from './useKnowledgeWorkbenchControllerViewState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchControllerInteractionArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = Omit<
  Parameters<
    typeof useKnowledgeWorkbenchControllerViewState<TKnowledgeBase, TConnector>
  >[0],
  'actions' | 'ruleSqlState'
> &
  Parameters<
    typeof useKnowledgeWorkbenchControllerOperations<TKnowledgeBase>
  >[0];
