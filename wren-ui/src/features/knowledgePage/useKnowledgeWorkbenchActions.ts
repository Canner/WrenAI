import useKnowledgeBaseLifecycle from '@/hooks/useKnowledgeBaseLifecycle';
import useKnowledgeBaseModal from '@/hooks/useKnowledgeBaseModal';
import useKnowledgePageActions from '@/hooks/useKnowledgePageActions';
import useKnowledgeRouteActions from '@/hooks/useKnowledgeRouteActions';
import type { AssetView, KnowledgeBaseRecord } from './types';

export function useKnowledgeWorkbenchActions<
  TKnowledgeBase extends KnowledgeBaseRecord,
>({
  activeKnowledgeBase,
  buildRuntimeScopeUrl,
  canCreateKnowledgeBase,
  createKnowledgeBaseBlockedReason,
  currentKnowledgeBaseId,
  isKnowledgeMutationDisabled,
  isReadonlyKnowledgeBase,
  isSnapshotReadonlyKnowledgeBase,
  kbForm,
  loadKnowledgeBases,
  openModalSafely,
  pushRoute,
  refetchRuntimeSelector,
  resolveLifecycleActionLabel,
  resetAssetDraft,
  router,
  routerAsPath,
  runtimeNavigationSelector,
  setAssetModalOpen,
  setAssetWizardStep,
  setDetailAsset,
  setSelectedKnowledgeBaseId,
  snapshotReadonlyHint,
}: {
  activeKnowledgeBase?: TKnowledgeBase | null;
  buildRuntimeScopeUrl: Parameters<
    typeof useKnowledgePageActions
  >[0]['buildRuntimeScopeUrl'];
  canCreateKnowledgeBase: boolean;
  createKnowledgeBaseBlockedReason: string;
  currentKnowledgeBaseId?: string | null;
  isKnowledgeMutationDisabled: boolean;
  isReadonlyKnowledgeBase: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  kbForm: Parameters<
    typeof useKnowledgeBaseModal<TKnowledgeBase>
  >[0]['kbForm'] &
    Parameters<typeof useKnowledgeBaseLifecycle<TKnowledgeBase>>[0]['kbForm'];
  loadKnowledgeBases: Parameters<
    typeof useKnowledgeBaseLifecycle<TKnowledgeBase>
  >[0]['loadKnowledgeBases'];
  openModalSafely: Parameters<
    typeof useKnowledgeBaseModal<TKnowledgeBase>
  >[0]['openModalSafely'];
  pushRoute: Parameters<typeof useKnowledgePageActions>[0]['pushRoute'];
  refetchRuntimeSelector: Parameters<
    typeof useKnowledgeBaseLifecycle<TKnowledgeBase>
  >[0]['refetchRuntimeSelector'];
  resolveLifecycleActionLabel: Parameters<
    typeof useKnowledgeBaseLifecycle<TKnowledgeBase>
  >[0]['resolveLifecycleActionLabel'];
  resetAssetDraft: Parameters<
    typeof useKnowledgePageActions
  >[0]['resetAssetDraft'];
  router: Parameters<typeof useKnowledgeRouteActions<AssetView>>[0]['router'];
  routerAsPath: string;
  runtimeNavigationSelector: Parameters<
    typeof useKnowledgePageActions
  >[0]['runtimeNavigationSelector'];
  setAssetModalOpen: Parameters<
    typeof useKnowledgePageActions
  >[0]['setAssetModalOpen'];
  setAssetWizardStep: Parameters<
    typeof useKnowledgePageActions
  >[0]['setAssetWizardStep'];
  setDetailAsset: Parameters<
    typeof useKnowledgeRouteActions<AssetView>
  >[0]['setDetailAsset'];
  setSelectedKnowledgeBaseId: Parameters<
    typeof useKnowledgeBaseLifecycle<TKnowledgeBase>
  >[0]['setSelectedKnowledgeBaseId'];
  snapshotReadonlyHint: string;
}) {
  const {
    kbModalOpen,
    editingKnowledgeBase,
    closeKnowledgeBaseModal,
    openCreateKnowledgeBaseModal,
    openEditKnowledgeBaseModal,
  } = useKnowledgeBaseModal<TKnowledgeBase>({
    canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason,
    isKnowledgeMutationDisabled,
    isSnapshotReadonlyKnowledgeBase,
    snapshotReadonlyHint,
    isReadonlyKnowledgeBase,
    activeKnowledgeBase,
    kbForm,
    openModalSafely,
  });

  const {
    closeAssetModal,
    openConnectorConsole,
    openAssetWizard,
    buildKnowledgeRuntimeSelector,
  } = useKnowledgePageActions({
    activeKnowledgeBase,
    runtimeNavigationSelector,
    buildRuntimeScopeUrl,
    pushRoute,
    isKnowledgeMutationDisabled,
    isSnapshotReadonlyKnowledgeBase,
    snapshotReadonlyHint,
    openModalSafely,
    setAssetModalOpen,
    setAssetWizardStep,
    resetAssetDraft,
  });

  const { replaceKnowledgeRoute, clearDetailAsset } =
    useKnowledgeRouteActions<AssetView>({
      router,
      setDetailAsset,
    });

  const { creatingKnowledgeBase, handleSaveKnowledgeBase } =
    useKnowledgeBaseLifecycle<TKnowledgeBase>({
      editingKnowledgeBase,
      activeKnowledgeBase,
      kbForm,
      closeKnowledgeBaseModal,
      loadKnowledgeBases,
      refetchRuntimeSelector,
      setSelectedKnowledgeBaseId,
      clearDetailAsset,
      currentKnowledgeBaseId,
      canManageKnowledgeBaseLifecycle: false,
      isSnapshotReadonlyKnowledgeBase,
      snapshotReadonlyHint,
      runtimeNavigationSelector,
      routerAsPath,
      buildRuntimeScopeUrl,
      buildKnowledgeRuntimeSelector,
      replaceRoute: replaceKnowledgeRoute,
      resolveLifecycleActionLabel,
    });

  return {
    buildKnowledgeRuntimeSelector,
    closeKnowledgeBaseModal,
    closeAssetModal,
    creatingKnowledgeBase,
    editingKnowledgeBase,
    handleSaveKnowledgeBase,
    kbModalOpen,
    openAssetWizard,
    openConnectorConsole,
    openCreateKnowledgeBaseModal,
    openEditKnowledgeBaseModal,
  };
}

export default useKnowledgeWorkbenchActions;
