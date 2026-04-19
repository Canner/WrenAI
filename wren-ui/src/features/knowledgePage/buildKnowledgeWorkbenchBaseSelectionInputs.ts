import useKnowledgeBaseSelection from '@/hooks/useKnowledgeBaseSelection';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchKnowledgeStateArgs } from './knowledgeWorkbenchKnowledgeStateTypes';

export function buildKnowledgeWorkbenchBaseSelectionInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  {
    hasRuntimeScope,
    routerAsPath,
    transitionTo,
  }: Pick<
    KnowledgeWorkbenchKnowledgeStateArgs<TKnowledgeBase, TConnector>,
    'hasRuntimeScope' | 'routerAsPath' | 'transitionTo'
  >,
  {
    currentKnowledgeBaseId,
    handleKnowledgeBaseLoadError,
    knowledgeBasesUrl,
    cachedKnowledgeBaseList,
    routeKnowledgeBaseId,
    fetchKnowledgeBaseList,
  }: {
    currentKnowledgeBaseId?: string | null;
    handleKnowledgeBaseLoadError: Parameters<
      typeof useKnowledgeBaseSelection<TKnowledgeBase>
    >[0]['onLoadError'];
    knowledgeBasesUrl?: string | null;
    cachedKnowledgeBaseList: Parameters<
      typeof useKnowledgeBaseSelection<TKnowledgeBase>
    >[0]['cachedKnowledgeBases'];
    routeKnowledgeBaseId?: string | null;
    fetchKnowledgeBaseList: Parameters<
      typeof useKnowledgeBaseSelection<TKnowledgeBase>
    >[0]['fetchKnowledgeBases'];
  },
): Parameters<typeof useKnowledgeBaseSelection<TKnowledgeBase>>[0] {
  return {
    hasRuntimeScope,
    knowledgeBasesUrl,
    cachedKnowledgeBases: cachedKnowledgeBaseList,
    routeKnowledgeBaseId,
    currentKnowledgeBaseId,
    currentPath: routerAsPath,
    fetchKnowledgeBases: fetchKnowledgeBaseList,
    transitionTo,
    shouldRouteSwitchKnowledgeBase: (knowledgeBase, currentId) =>
      Boolean(knowledgeBase.id) && knowledgeBase.id !== currentId,
    onLoadError: handleKnowledgeBaseLoadError,
  };
}

export default buildKnowledgeWorkbenchBaseSelectionInputs;
