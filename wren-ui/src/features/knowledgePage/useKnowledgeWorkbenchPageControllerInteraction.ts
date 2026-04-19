import type { NextRouter } from 'next/router';

import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';

import { buildKnowledgeWorkbenchPageInteractionArgs } from './buildKnowledgeWorkbenchPageControllerInteractionArgs';
import useKnowledgePageLocalState from './useKnowledgePageLocalState';
import useKnowledgeWorkbenchPageInteractionState from './useKnowledgeWorkbenchPageInteractionState';
import type { KnowledgeWorkbenchPageControllerDataState } from './knowledgeWorkbenchPageControllerTypes';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

type KnowledgeWorkbenchPageControllerInteractionArgs = {
  controllerDataState: KnowledgeWorkbenchPageControllerDataState<
    KnowledgeBaseRecord,
    ConnectorView
  >;
  hasRuntimeScope: boolean;
  localState: ReturnType<typeof useKnowledgePageLocalState>;
  pushRoute: (url: string) => Promise<boolean>;
  replaceWorkspace: ReturnType<
    typeof useRuntimeScopeNavigation
  >['replaceWorkspace'];
  router: NextRouter;
  routerAsPath: string;
  routerQuery: Record<string, string | string[] | undefined>;
  runtimeNavigationSelector: ReturnType<
    typeof useRuntimeScopeNavigation
  >['selector'];
};

export default function useKnowledgeWorkbenchPageControllerInteraction({
  controllerDataState,
  hasRuntimeScope,
  localState,
  pushRoute,
  replaceWorkspace,
  router,
  routerAsPath,
  routerQuery,
  runtimeNavigationSelector,
}: KnowledgeWorkbenchPageControllerInteractionArgs) {
  return useKnowledgeWorkbenchPageInteractionState<
    KnowledgeBaseRecord,
    ConnectorView
  >(
    buildKnowledgeWorkbenchPageInteractionArgs<
      KnowledgeBaseRecord,
      ConnectorView
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
      snapshotReadonlyHint: HISTORICAL_SNAPSHOT_READONLY_HINT,
      runtimeNavigationSelector,
    }),
  );
}
