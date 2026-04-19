import useKnowledgePageLocalState from './useKnowledgePageLocalState';
import useKnowledgeWorkbenchControllerDataState from './useKnowledgeWorkbenchControllerDataState';
import useKnowledgeWorkbenchPageInteractionState from './useKnowledgeWorkbenchPageInteractionState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchPageControllerLocalState = ReturnType<
  typeof useKnowledgePageLocalState
>;

export type KnowledgeWorkbenchPageControllerDataState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = ReturnType<
  typeof useKnowledgeWorkbenchControllerDataState<TKnowledgeBase, TConnector>
>;

export type KnowledgeWorkbenchPageControllerInteractionState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = ReturnType<
  typeof useKnowledgeWorkbenchPageInteractionState<TKnowledgeBase, TConnector>
>;
