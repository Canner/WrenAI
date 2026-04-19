import useKnowledgeWorkbenchControllerOperations from './useKnowledgeWorkbenchControllerOperations';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchControllerInteractionArgs } from './knowledgeWorkbenchControllerInteractionTypes';

export function buildKnowledgeWorkbenchControllerOperationsInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  activeKnowledgeBase,
  activeKnowledgeRuntimeSelector,
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
  ruleForm,
  ruleSqlCacheScopeKey,
  runtimeNavigationSelector,
  setAssetModalOpen,
  setAssetWizardStep,
  setDetailAsset,
  setSelectedKnowledgeBaseId,
  snapshotReadonlyHint,
  sqlTemplateForm,
}: KnowledgeWorkbenchControllerInteractionArgs<
  TKnowledgeBase,
  TConnector
>): Parameters<
  typeof useKnowledgeWorkbenchControllerOperations<TKnowledgeBase>
>[0] {
  return {
    activeKnowledgeBase,
    activeKnowledgeRuntimeSelector,
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
    ruleForm,
    ruleSqlCacheScopeKey,
    runtimeNavigationSelector,
    setAssetModalOpen,
    setAssetWizardStep,
    setDetailAsset,
    setSelectedKnowledgeBaseId,
    snapshotReadonlyHint,
    sqlTemplateForm,
  };
}

export default buildKnowledgeWorkbenchControllerOperationsInputs;
