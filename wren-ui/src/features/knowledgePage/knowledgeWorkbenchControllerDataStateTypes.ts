import useKnowledgeWorkbenchContentData from './useKnowledgeWorkbenchContentData';
import useKnowledgeWorkbenchKnowledgeState from './useKnowledgeWorkbenchKnowledgeState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchControllerDataStateArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = {
  assetModalOpen: boolean;
  buildRuntimeScopeUrl: Parameters<
    typeof useKnowledgeWorkbenchKnowledgeState<TKnowledgeBase, TConnector>
  >[0]['buildRuntimeScopeUrl'];
  draftAssets: Parameters<
    typeof useKnowledgeWorkbenchContentData<TKnowledgeBase, TConnector>
  >[0]['draftAssets'];
  hasRuntimeScope: boolean;
  routerAsPath: string;
  routerQuery: Record<string, string | string[] | undefined>;
  routerReady: boolean;
  runtimeNavigationWorkspaceId?: string | null;
  runtimeTransitioning: boolean;
  transitionTo: Parameters<
    typeof useKnowledgeWorkbenchKnowledgeState<TKnowledgeBase, TConnector>
  >[0]['transitionTo'];
};

export type KnowledgeWorkbenchControllerDataKnowledgeState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = ReturnType<
  typeof useKnowledgeWorkbenchKnowledgeState<TKnowledgeBase, TConnector>
>;

export type KnowledgeWorkbenchControllerDataContentState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = ReturnType<
  typeof useKnowledgeWorkbenchContentData<TKnowledgeBase, TConnector>
>;
