import type { KnowledgeWorkbenchControllerStageArgs } from './knowledgeWorkbenchControllerStageTypes';
import type {
  KnowledgeWorkbenchPageControllerDataState,
  KnowledgeWorkbenchPageControllerInteractionState,
  KnowledgeWorkbenchPageControllerLocalState,
} from './knowledgeWorkbenchPageControllerTypes';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export function buildKnowledgeWorkbenchPageStageArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  canSaveKnowledgeBase,
  controllerDataState,
  interactionState,
  localState,
}: {
  canSaveKnowledgeBase: boolean;
  controllerDataState: KnowledgeWorkbenchPageControllerDataState<
    TKnowledgeBase,
    TConnector
  >;
  interactionState: KnowledgeWorkbenchPageControllerInteractionState<
    TKnowledgeBase,
    TConnector
  >;
  localState: KnowledgeWorkbenchPageControllerLocalState;
}): KnowledgeWorkbenchControllerStageArgs {
  const { contentData, knowledgeState, modelingState } = controllerDataState;
  const { actions, ruleSqlState, viewState } = interactionState;

  return {
    actions,
    contentData,
    knowledgeState,
    localState: {
      ...localState,
      canSaveKnowledgeBase,
    },
    modelingState,
    ruleSqlState,
    viewState,
  };
}

export default buildKnowledgeWorkbenchPageStageArgs;
