import useKnowledgeWorkbenchNavigationState from './useKnowledgeWorkbenchNavigationState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchPresentationStateArgs } from './knowledgeWorkbenchPresentationStateTypes';

export function buildKnowledgeWorkbenchNavigationStateInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  activeKnowledgeBase,
  buildKnowledgeRuntimeSelector,
  buildRuntimeScopeUrl,
  knowledgeBases,
  knowledgeTab,
  openAssetWizard,
  replaceWorkspace,
  routerQuery,
  setDetailAsset,
}: KnowledgeWorkbenchPresentationStateArgs<
  TKnowledgeBase,
  TConnector
>): Parameters<typeof useKnowledgeWorkbenchNavigationState<TKnowledgeBase>>[0] {
  return {
    activeKnowledgeBase,
    buildKnowledgeRuntimeSelector,
    buildRuntimeScopeUrl,
    knowledgeBases,
    knowledgeTab,
    openAssetWizard,
    replaceWorkspace,
    routerQuery,
    setDetailAsset,
  };
}

export default buildKnowledgeWorkbenchNavigationStateInputs;
