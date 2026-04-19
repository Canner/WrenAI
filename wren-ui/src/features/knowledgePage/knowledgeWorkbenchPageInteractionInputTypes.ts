import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchPageInteractionControllerDataState } from './knowledgeWorkbenchPageInteractionDataTypes';
import type { KnowledgeWorkbenchPageInteractionControllerArgs } from './knowledgeWorkbenchPageInteractionControllerTypes';

export type { KnowledgeWorkbenchControllerInteractionInputs } from './knowledgeWorkbenchPageInteractionControllerTypes';
export type {
  KnowledgeWorkbenchContentData,
  KnowledgeWorkbenchKnowledgeState,
} from './knowledgeWorkbenchPageInteractionDataTypes';
export type { KnowledgeWorkbenchPageInteractionLocalState } from './knowledgeWorkbenchPageInteractionLocalTypes';
export type { KnowledgeWorkbenchPageInteractionControllerArgs } from './knowledgeWorkbenchPageInteractionControllerTypes';

export type KnowledgeWorkbenchPageInteractionArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = KnowledgeWorkbenchPageInteractionControllerArgs<
  TKnowledgeBase,
  TConnector
> & {
  controllerDataState: KnowledgeWorkbenchPageInteractionControllerDataState<
    TKnowledgeBase,
    TConnector
  >;
};
