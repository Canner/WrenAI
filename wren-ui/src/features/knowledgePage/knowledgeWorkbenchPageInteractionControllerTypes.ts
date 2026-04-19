import type { NextRouter } from 'next/router';
import useKnowledgeWorkbenchControllerInteractionState from './useKnowledgeWorkbenchControllerInteractionState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchPageInteractionLocalState } from './knowledgeWorkbenchPageInteractionLocalTypes';

export type KnowledgeWorkbenchPageInteractionControllerArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = {
  buildRuntimeScopeUrl: Parameters<
    typeof useKnowledgeWorkbenchControllerInteractionState<
      TKnowledgeBase,
      TConnector
    >
  >[0]['buildRuntimeScopeUrl'];
  hasRuntimeScope: boolean;
  localState: KnowledgeWorkbenchPageInteractionLocalState;
  pushRoute: Parameters<
    typeof useKnowledgeWorkbenchControllerInteractionState<
      TKnowledgeBase,
      TConnector
    >
  >[0]['pushRoute'];
  replaceWorkspace: Parameters<
    typeof useKnowledgeWorkbenchControllerInteractionState<
      TKnowledgeBase,
      TConnector
    >
  >[0]['replaceWorkspace'];
  router: NextRouter;
  routerAsPath: string;
  routerQuery: Record<string, string | string[] | undefined>;
  snapshotReadonlyHint: Parameters<
    typeof useKnowledgeWorkbenchControllerInteractionState<
      TKnowledgeBase,
      TConnector
    >
  >[0]['snapshotReadonlyHint'];
  runtimeNavigationSelector: Parameters<
    typeof useKnowledgeWorkbenchControllerInteractionState<
      TKnowledgeBase,
      TConnector
    >
  >[0]['runtimeNavigationSelector'];
};

export type KnowledgeWorkbenchControllerInteractionInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = Parameters<
  typeof useKnowledgeWorkbenchControllerInteractionState<
    TKnowledgeBase,
    TConnector
  >
>[0];
