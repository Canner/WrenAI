import { useRouter } from 'next/router';

import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeScopeTransition from '@/hooks/useRuntimeScopeTransition';

import buildKnowledgeWorkbenchControllerStage from './buildKnowledgeWorkbenchControllerStage';
import { buildKnowledgeWorkbenchPageStageArgs } from './buildKnowledgeWorkbenchPageStageArgs';
import useKnowledgePageLocalState from './useKnowledgePageLocalState';
import useKnowledgeWorkbenchPageControllerData from './useKnowledgeWorkbenchPageControllerData';
import useKnowledgeWorkbenchPageControllerInteraction from './useKnowledgeWorkbenchPageControllerInteraction';

export function useKnowledgeWorkbenchPageController() {
  const router = useRouter();
  const routerQuery = router.query as Record<
    string,
    string | string[] | undefined
  >;
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopeTransition = useRuntimeScopeTransition();
  const localState = useKnowledgePageLocalState();

  const controllerDataState = useKnowledgeWorkbenchPageControllerData({
    assetModalOpen: localState.assetModalOpen,
    draftAssets: localState.draftAssets,
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    routerAsPath: router.asPath,
    routerQuery,
    routerReady: router.isReady,
    runtimeNavigationWorkspaceId: runtimeScopeNavigation.selector.workspaceId,
    runtimeTransitioning: runtimeScopeTransition.transitioning,
    transitionTo: runtimeScopeTransition.transitionTo,
  });
  const interactionState = useKnowledgeWorkbenchPageControllerInteraction({
    controllerDataState,
    hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
    localState,
    pushRoute: (url) => router.push(url, undefined, { scroll: false }),
    replaceWorkspace: runtimeScopeNavigation.replaceWorkspace,
    router,
    routerAsPath: router.asPath,
    routerQuery,
    runtimeNavigationSelector: runtimeScopeNavigation.selector,
  });
  const canSaveKnowledgeBase = Boolean(localState.kbNameValue?.trim());
  const { sidebarProps, mainStageProps, overlaysProps } =
    buildKnowledgeWorkbenchControllerStage(
      buildKnowledgeWorkbenchPageStageArgs({
        canSaveKnowledgeBase,
        controllerDataState,
        interactionState,
        localState,
      }),
    );

  return {
    loading: runtimeScopePage.guarding,
    mainStageProps,
    overlaysProps,
    sidebarProps,
  };
}

export default useKnowledgeWorkbenchPageController;
