import useKnowledgeWorkbenchControllerDataState from './useKnowledgeWorkbenchControllerDataState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchPageInteractionControllerDataState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = ReturnType<
  typeof useKnowledgeWorkbenchControllerDataState<TKnowledgeBase, TConnector>
>;

export type KnowledgeWorkbenchKnowledgeState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = KnowledgeWorkbenchPageInteractionControllerDataState<
  TKnowledgeBase,
  TConnector
>['knowledgeState'];

export type KnowledgeWorkbenchContentData<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = KnowledgeWorkbenchPageInteractionControllerDataState<
  TKnowledgeBase,
  TConnector
>['contentData'];
