import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerViewOperationState } from './knowledgeWorkbenchControllerViewOperationTypes';
import type { KnowledgeWorkbenchControllerViewStateInputs } from './knowledgeWorkbenchControllerViewStateInputTypes';

export type { KnowledgeWorkbenchControllerViewOperationState } from './knowledgeWorkbenchControllerViewOperationTypes';
export type { KnowledgeWorkbenchControllerViewStateInputs } from './knowledgeWorkbenchControllerViewStateInputTypes';

export type KnowledgeWorkbenchControllerViewArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = KnowledgeWorkbenchControllerViewOperationState<TKnowledgeBase> &
  KnowledgeWorkbenchControllerViewStateInputs<TKnowledgeBase, TConnector>;
