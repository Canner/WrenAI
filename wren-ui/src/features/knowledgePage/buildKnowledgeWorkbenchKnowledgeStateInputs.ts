import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';
import useKnowledgeWorkbenchKnowledgeState from './useKnowledgeWorkbenchKnowledgeState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerDataStateArgs } from './knowledgeWorkbenchControllerDataStateTypes';

export function buildKnowledgeWorkbenchKnowledgeStateInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  buildRuntimeScopeUrl,
  hasRuntimeScope,
  routerAsPath,
  routerQuery,
  routerReady,
  runtimeNavigationWorkspaceId,
  transitionTo,
}: KnowledgeWorkbenchControllerDataStateArgs<
  TKnowledgeBase,
  TConnector
>): Parameters<
  typeof useKnowledgeWorkbenchKnowledgeState<TKnowledgeBase, TConnector>
>[0] {
  return {
    buildRuntimeScopeUrl,
    hasRuntimeScope,
    routerAsPath,
    routerQuery,
    routerReady,
    runtimeNavigationWorkspaceId,
    transitionTo,
    snapshotReadonlyHint: HISTORICAL_SNAPSHOT_READONLY_HINT,
  };
}

export default buildKnowledgeWorkbenchKnowledgeStateInputs;
