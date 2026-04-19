import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';

import useKnowledgeWorkbenchControllerDataState from './useKnowledgeWorkbenchControllerDataState';
import type { AssetView, ConnectorView, KnowledgeBaseRecord } from './types';

type KnowledgeWorkbenchPageControllerDataArgs = {
  assetModalOpen: boolean;
  draftAssets: AssetView[];
  hasRuntimeScope: boolean;
  routerAsPath: string;
  routerQuery: Record<string, string | string[] | undefined>;
  routerReady: boolean;
  runtimeNavigationWorkspaceId?: string;
  runtimeTransitioning: boolean;
  transitionTo: (url: string) => Promise<unknown>;
};

export default function useKnowledgeWorkbenchPageControllerData({
  assetModalOpen,
  draftAssets,
  hasRuntimeScope,
  routerAsPath,
  routerQuery,
  routerReady,
  runtimeNavigationWorkspaceId,
  runtimeTransitioning,
  transitionTo,
}: KnowledgeWorkbenchPageControllerDataArgs) {
  return useKnowledgeWorkbenchControllerDataState<
    KnowledgeBaseRecord,
    ConnectorView
  >({
    assetModalOpen,
    buildRuntimeScopeUrl,
    hasRuntimeScope,
    routerAsPath,
    routerQuery,
    routerReady,
    draftAssets,
    runtimeNavigationWorkspaceId,
    runtimeTransitioning,
    transitionTo,
  });
}
