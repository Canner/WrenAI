import useKnowledgeAssetDetail from '@/hooks/useKnowledgeAssetDetail';
import useKnowledgeAssetInteractions from '@/hooks/useKnowledgeAssetInteractions';
import useKnowledgeAssetSelectOptions from '@/hooks/useKnowledgeAssetSelectOptions';
import useKnowledgeAssetWizard from '@/hooks/useKnowledgeAssetWizard';
import useKnowledgeDerivedCollections from '@/hooks/useKnowledgeDerivedCollections';
import type { AssetView, ConnectorView } from './types';

export function useKnowledgeAssetWorkbench({
  activeKnowledgeBaseExecutable,
  activeKnowledgeBaseId,
  assetDraft,
  assets,
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
  resetDetailViewState,
  routeRuntimeSyncing,
  saveAssetDraftToOverviewExternal,
  selectedConnectorId,
  selectedDemoKnowledge,
  selectedDemoTable,
  setAssetDraft,
  setAssetWizardStep,
  setDetailAsset,
  setDraftAssets,
}: {
  activeKnowledgeBaseExecutable: boolean;
  activeKnowledgeBaseId?: string | null;
  assetDraft: Parameters<typeof useKnowledgeAssetWizard>[0]['assetDraft'];
  assets: AssetView[];
  connectors: ConnectorView[];
  demoDatabaseOptions: Parameters<
    typeof useKnowledgeAssetSelectOptions
  >[0]['demoDatabaseOptions'];
  demoTableOptions: Parameters<
    typeof useKnowledgeAssetSelectOptions
  >[0]['demoTableOptions'];
  detailAsset?: AssetView | null;
  detailFieldFilter: Parameters<
    typeof useKnowledgeAssetDetail
  >[0]['detailFieldFilter'];
  detailFieldKeyword: string;
  diagramData?: { diagram?: unknown } | null;
  diagramLoading: boolean;
  isDemoSource: boolean;
  knowledgeOwner?: string | null;
  openModalSafely: Parameters<
    typeof useKnowledgeAssetInteractions<AssetView>
  >[0]['openModalSafely'];
  overviewPreviewAsset?: AssetView | null;
  pendingKnowledgeBaseId?: string | null;
  resetDetailViewState: () => void;
  routeRuntimeSyncing: boolean;
  saveAssetDraftToOverviewExternal?: () => AssetView | null;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: Parameters<
    typeof useKnowledgeDerivedCollections
  >[0]['selectedDemoKnowledge'];
  selectedDemoTable?: string;
  setAssetDraft: Parameters<typeof useKnowledgeAssetWizard>[0]['setAssetDraft'];
  setAssetWizardStep: Parameters<
    typeof useKnowledgeAssetWizard
  >[0]['setAssetWizardStep'];
  setDetailAsset: Parameters<
    typeof useKnowledgeAssetInteractions<AssetView>
  >[0]['setDetailAsset'];
  setDraftAssets: Parameters<
    typeof useKnowledgeAssetWizard
  >[0]['setDraftAssets'];
}) {
  const { assetDatabaseOptions, assetTableOptions } =
    useKnowledgeAssetSelectOptions({
      connectors,
      isDemoSource,
      demoDatabaseOptions,
      demoTableOptions,
      assets,
    });

  const {
    wizardPreviewAssets,
    visibleKnowledgeBaseId,
    detailAssets,
    showKnowledgeAssetsLoading,
  } = useKnowledgeDerivedCollections({
    assets,
    selectedDemoKnowledge,
    activeKnowledgeBaseId,
    pendingKnowledgeBaseId,
    overviewPreviewAsset,
    activeKnowledgeBaseUsesRuntime: activeKnowledgeBaseExecutable,
    diagramLoading,
    hasDiagramData: Boolean(diagramData?.diagram),
    routeRuntimeSyncing,
  });

  const {
    assetDraftPreview,
    canContinueAssetConfiguration,
    moveAssetWizardToConfig,
    saveAssetDraftToOverview,
  } = useKnowledgeAssetWizard({
    assetDraft,
    connectors,
    demoTableOptions,
    isDemoSource,
    knowledgeOwner,
    selectedConnectorId,
    selectedDemoKnowledge,
    selectedDemoTable,
    setAssetDraft,
    setAssetWizardStep,
    setDetailAsset,
    setDraftAssets,
    wizardPreviewAssets,
  });

  const { commitAssetDraftToOverview, openAssetDetail } =
    useKnowledgeAssetInteractions<AssetView>({
      saveAssetDraftToOverview:
        saveAssetDraftToOverviewExternal || saveAssetDraftToOverview,
      blurActiveElement: () => {
        if (typeof document !== 'undefined') {
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
      },
      resetDetailViewState,
      openModalSafely,
      setDetailAsset,
    });

  const { activeDetailAsset, detailAssetFields } = useKnowledgeAssetDetail({
    detailAssets,
    detailAsset,
    detailFieldKeyword,
    detailFieldFilter,
    resetDetailViewState,
  });

  return {
    activeDetailAsset,
    assetDatabaseOptions,
    assetDraftPreview,
    assetTableOptions,
    canContinueAssetConfiguration,
    commitAssetDraftToOverview,
    detailAssetFields,
    detailAssets,
    moveAssetWizardToConfig,
    openAssetDetail,
    showKnowledgeAssetsLoading,
    visibleKnowledgeBaseId,
  };
}

export default useKnowledgeAssetWorkbench;
