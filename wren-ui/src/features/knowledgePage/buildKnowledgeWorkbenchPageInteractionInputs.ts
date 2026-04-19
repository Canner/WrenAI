import { buildKnowledgeWorkbenchPageInteractionContentInputs } from './buildKnowledgeWorkbenchPageInteractionContentInputs';
import { buildKnowledgeWorkbenchPageInteractionKnowledgeInputs } from './buildKnowledgeWorkbenchPageInteractionKnowledgeInputs';
import { buildKnowledgeWorkbenchPageInteractionLocalInputs } from './buildKnowledgeWorkbenchPageInteractionLocalInputs';
import useKnowledgeWorkbenchControllerInteractionState from './useKnowledgeWorkbenchControllerInteractionState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchPageInteractionArgs } from './knowledgeWorkbenchPageInteractionInputTypes';

export type { KnowledgeWorkbenchPageInteractionArgs } from './knowledgeWorkbenchPageInteractionInputTypes';

export function buildKnowledgeWorkbenchPageInteractionInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  buildRuntimeScopeUrl,
  controllerDataState,
  hasRuntimeScope,
  localState,
  pushRoute,
  replaceWorkspace,
  router,
  routerAsPath,
  routerQuery,
  snapshotReadonlyHint,
  runtimeNavigationSelector,
}: KnowledgeWorkbenchPageInteractionArgs<
  TKnowledgeBase,
  TConnector
>): Parameters<
  typeof useKnowledgeWorkbenchControllerInteractionState<
    TKnowledgeBase,
    TConnector
  >
>[0] {
  const { contentData, knowledgeState } = controllerDataState;

  return {
    buildRuntimeScopeUrl,
    hasRuntimeScope,
    pushRoute,
    replaceWorkspace,
    router,
    routerAsPath,
    routerQuery,
    runtimeNavigationSelector,
    snapshotReadonlyHint,
    ...buildKnowledgeWorkbenchPageInteractionLocalInputs<
      TKnowledgeBase,
      TConnector
    >(localState),
    ...buildKnowledgeWorkbenchPageInteractionKnowledgeInputs<
      TKnowledgeBase,
      TConnector
    >(knowledgeState),
    ...buildKnowledgeWorkbenchPageInteractionContentInputs<
      TKnowledgeBase,
      TConnector
    >(contentData),
  };
}

export default buildKnowledgeWorkbenchPageInteractionInputs;
