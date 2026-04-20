import { openModalSafely } from './constants';
import useKnowledgeAssetWorkbench from './useKnowledgeAssetWorkbench';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchPresentationStateArgs } from './knowledgeWorkbenchPresentationStateTypes';

export function buildKnowledgeAssetWorkbenchInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  activeKnowledgeBase,
  activeKnowledgeBaseExecutable,
  activeKnowledgeRuntimeSelector,
  assetDraft,
  assets,
  buildRuntimeScopeUrl,
  connectors,
  demoDatabaseOptions,
  demoTableOptions,
  detailAsset,
  detailFieldFilter,
  detailFieldKeyword,
  diagramData,
  diagramLoading,
  isDemoSource,
  knowledgeOwner,
  overviewPreviewAsset,
  pendingKnowledgeBaseId,
  refetchDiagram,
  resetDetailViewState,
  routeRuntimeSyncing,
  selectedConnectorId,
  selectedDemoKnowledge,
  selectedDemoTable,
  setAssetDraft,
  setAssetWizardStep,
  setDetailAsset,
  setDraftAssets,
}: KnowledgeWorkbenchPresentationStateArgs<
  TKnowledgeBase,
  TConnector
>): Parameters<typeof useKnowledgeAssetWorkbench>[0] {
  return {
    activeKnowledgeBaseExecutable,
    activeKnowledgeBaseId: activeKnowledgeBase?.id,
    activeKnowledgeRuntimeSelector,
    assetDraft,
    assets,
    buildRuntimeScopeUrl,
    connectors,
    demoDatabaseOptions,
    demoTableOptions,
    detailAsset,
    detailFieldFilter,
    detailFieldKeyword,
    diagramData,
    diagramLoading,
    isDemoSource,
    knowledgeOwner,
    openModalSafely,
    overviewPreviewAsset,
    pendingKnowledgeBaseId,
    refetchDiagram,
    resetDetailViewState,
    routeRuntimeSyncing,
    selectedConnectorId,
    selectedDemoKnowledge,
    selectedDemoTable,
    setAssetDraft,
    setAssetWizardStep,
    setDetailAsset,
    setDraftAssets,
  };
}

export default buildKnowledgeAssetWorkbenchInputs;
