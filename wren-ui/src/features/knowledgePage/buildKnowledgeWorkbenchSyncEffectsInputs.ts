import useKnowledgeWorkbenchSyncEffects from './useKnowledgeWorkbenchSyncEffects';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchViewStateArgs } from './knowledgeWorkbenchViewStateTypes';

export function buildKnowledgeWorkbenchSyncEffectsInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  activeKnowledgeBase,
  activeKnowledgeSnapshotId,
  currentKnowledgeBaseId,
  hasRuntimeScope,
  loadRuleList,
  loadSqlList,
  pendingKnowledgeBaseId,
  refetchReady,
  resetAssetDraft,
  resetDetailViewState,
  resetRuleSqlManagerState,
  routeKnowledgeBaseId,
  routeRuntimeSyncing,
  setAssetModalOpen,
  setAssetWizardStep,
  setDetailAsset,
  setDraftAssets,
  setPendingKnowledgeBaseId,
  setSelectedConnectorId,
  setSelectedDemoTable,
  setSelectedKnowledgeBaseId,
}: KnowledgeWorkbenchViewStateArgs<TKnowledgeBase, TConnector>): Parameters<
  typeof useKnowledgeWorkbenchSyncEffects
>[0] {
  return {
    activeKnowledgeBaseId: activeKnowledgeBase?.id,
    activeKnowledgeSnapshotId,
    currentKnowledgeBaseId,
    hasRuntimeScope,
    loadRuleList,
    loadSqlList,
    pendingKnowledgeBaseId,
    refetchReady,
    resetAssetDraft,
    resetDetailViewState,
    resetRuleSqlManagerState,
    routeKnowledgeBaseId,
    routeRuntimeSyncing,
    setAssetModalOpen,
    setAssetWizardStep,
    setDetailAsset,
    setDraftAssets,
    setPendingKnowledgeBaseId,
    setSelectedConnectorId,
    setSelectedDemoTable,
    setSelectedKnowledgeBaseId,
  };
}

export default buildKnowledgeWorkbenchSyncEffectsInputs;
