import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import useKnowledgeSidebarData from '@/hooks/useKnowledgeSidebarData';
import useKnowledgeWorkbenchSectionRouting from './useKnowledgeWorkbenchSectionRouting';
import type { AssetView, KnowledgeBaseRecord } from './types';

export function useKnowledgeWorkbenchNavigationState<
  TKnowledgeBase extends KnowledgeBaseRecord,
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
}: {
  activeKnowledgeBase?: TKnowledgeBase | null;
  buildKnowledgeRuntimeSelector: Parameters<
    typeof useKnowledgeWorkbenchSectionRouting<TKnowledgeBase>
  >[0]['buildKnowledgeRuntimeSelector'];
  buildRuntimeScopeUrl: Parameters<
    typeof useKnowledgeWorkbenchSectionRouting<TKnowledgeBase>
  >[0]['buildRuntimeScopeUrl'];
  knowledgeBases: TKnowledgeBase[];
  knowledgeTab: string;
  openAssetWizard: () => void;
  replaceWorkspace: Parameters<
    typeof useKnowledgeWorkbenchSectionRouting<TKnowledgeBase>
  >[0]['replaceWorkspace'];
  routerQuery: Parameters<
    typeof useKnowledgeWorkbenchSectionRouting<TKnowledgeBase>
  >[0]['routerQuery'];
  setDetailAsset: Dispatch<SetStateAction<AssetView | null>>;
}) {
  const { visibleKnowledgeItems } = useKnowledgeSidebarData({
    threads: [],
    knowledgeBases,
    activeKnowledgeBase,
    knowledgeTab,
  });

  const {
    activeWorkbenchSection,
    handleChangeWorkbenchSection,
    buildKnowledgeSwitchUrl,
    handleNavigateModeling,
  } = useKnowledgeWorkbenchSectionRouting<TKnowledgeBase>({
    routerQuery,
    replaceWorkspace,
    buildRuntimeScopeUrl,
    buildKnowledgeRuntimeSelector,
  });

  const handleCloseAssetDetail = useCallback(() => {
    setDetailAsset(null);
  }, [setDetailAsset]);

  const handleOpenAssetWizard = useCallback(() => {
    openAssetWizard();
  }, [openAssetWizard]);

  return {
    activeWorkbenchSection,
    buildKnowledgeSwitchUrl,
    handleChangeWorkbenchSection,
    handleCloseAssetDetail,
    handleNavigateModeling,
    handleOpenAssetWizard,
    visibleKnowledgeItems,
  };
}

export default useKnowledgeWorkbenchNavigationState;
