import { getKnowledgeLifecycleActionLabel } from '@/hooks/useKnowledgePageHelpers';
import { openModalSafely } from './constants';
import useKnowledgeWorkbenchActions from './useKnowledgeWorkbenchActions';
import type { KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerOperationsArgs } from './knowledgeWorkbenchControllerOperationsTypes';

export function buildKnowledgeWorkbenchActionsInputs<
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
  pushRoute,
  refetchRuntimeSelector,
  resetAssetDraft,
  router,
  routerAsPath,
  runtimeNavigationSelector,
  setAssetModalOpen,
  setAssetWizardStep,
  setDetailAsset,
  setSelectedKnowledgeBaseId,
  snapshotReadonlyHint,
}: KnowledgeWorkbenchControllerOperationsArgs<TKnowledgeBase>): Parameters<
  typeof useKnowledgeWorkbenchActions<TKnowledgeBase>
>[0] {
  return {
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
    resolveLifecycleActionLabel: getKnowledgeLifecycleActionLabel,
    resetAssetDraft,
    router,
    routerAsPath,
    runtimeNavigationSelector,
    setAssetModalOpen,
    setAssetWizardStep,
    setDetailAsset,
    setSelectedKnowledgeBaseId,
    snapshotReadonlyHint,
  };
}

export default buildKnowledgeWorkbenchActionsInputs;
