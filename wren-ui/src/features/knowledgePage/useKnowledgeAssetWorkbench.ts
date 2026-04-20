import { useCallback } from 'react';
import { useRouter } from 'next/router';
import { message } from 'antd';
import {
  buildRuntimeScopeUrl,
  omitRuntimeScopeQuery,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type { SelectedAssetTableValue } from '@/features/knowledgePage/types';
import useKnowledgeAssetDetail from '@/hooks/useKnowledgeAssetDetail';
import useKnowledgeAssetInteractions from '@/hooks/useKnowledgeAssetInteractions';
import useKnowledgeAssetSelectOptions from '@/hooks/useKnowledgeAssetSelectOptions';
import useKnowledgeConnectorTables from '@/hooks/useKnowledgeConnectorTables';
import useKnowledgeAssetWizard from '@/hooks/useKnowledgeAssetWizard';
import useKnowledgeDerivedCollections from '@/hooks/useKnowledgeDerivedCollections';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import type { AssetView, ConnectorView } from './types';

export function useKnowledgeAssetWorkbench({
  activeKnowledgeBaseExecutable,
  activeKnowledgeBaseId,
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
  resetDetailViewState,
  routeRuntimeSyncing,
  refetchDiagram,
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
  activeKnowledgeRuntimeSelector?: Parameters<
    typeof useKnowledgeAssetWizard
  >[0]['activeKnowledgeRuntimeSelector'];
  assetDraft: Parameters<typeof useKnowledgeAssetWizard>[0]['assetDraft'];
  assets: AssetView[];
  buildRuntimeScopeUrl: Parameters<
    typeof useKnowledgeConnectorTables
  >[0]['buildRuntimeScopeUrl'];
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
  refetchDiagram?: Parameters<
    typeof useKnowledgeAssetWizard
  >[0]['refetchDiagram'];
  saveAssetDraftToOverviewExternal?: () =>
    | Promise<AssetView | null>
    | AssetView
    | null;
  selectedConnectorId?: string;
  selectedDemoKnowledge?: Parameters<
    typeof useKnowledgeDerivedCollections
  >[0]['selectedDemoKnowledge'];
  selectedDemoTable?: SelectedAssetTableValue;
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
  const router = useRouter();
  const runtimeSelectorState = useRuntimeSelectorState();
  const selectedConnector = connectors.find(
    (connector) => connector.id === selectedConnectorId,
  );
  const handleConnectorTablesLoadError = useCallback((error: unknown) => {
    message.error(
      error instanceof Error
        ? error.message
        : '加载连接器数据表失败，请稍后重试。',
    );
  }, []);
  const { connectorTables } = useKnowledgeConnectorTables({
    buildRuntimeScopeUrl,
    connectorId: selectedConnectorId,
    workspaceId: selectedConnector?.workspaceId || null,
    enabled: !isDemoSource && Boolean(selectedConnectorId),
    onLoadError: handleConnectorTablesLoadError,
  });

  const replaceRuntimeScope = useCallback(
    async (selector: ClientRuntimeScopeSelector) => {
      const nextUrl = buildRuntimeScopeUrl(
        router.pathname,
        omitRuntimeScopeQuery(
          router.query as Record<string, string | string[] | undefined>,
        ),
        selector,
      );
      return router.replace(nextUrl, undefined, { scroll: false });
    },
    [router],
  );

  const { assetDatabaseOptions, assetTableOptions } =
    useKnowledgeAssetSelectOptions({
      assets,
      connectors,
      isDemoSource,
      demoDatabaseOptions,
      demoTableOptions,
      connectorTables,
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
    assetDraftPreviews,
    canContinueAssetConfiguration,
    moveAssetWizardToConfig,
    saveAssetDraftToOverview,
  } = useKnowledgeAssetWizard({
    assetDraft,
    connectorTables,
    connectors,
    demoTableOptions,
    isDemoSource,
    knowledgeOwner,
    selectedConnectorId,
    selectedDemoKnowledge,
    selectedDemoTable,
    activeKnowledgeRuntimeSelector,
    refetchDiagram,
    refetchRuntimeSelector: runtimeSelectorState.refetch,
    replaceRuntimeScope,
    setAssetDraft,
    setAssetWizardStep,
    setDetailAsset,
    setDraftAssets,
    wizardPreviewAssets,
  });

  const { commitAssetDraftToOverview, openAssetDetail, savingAssetDraft } =
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
    assetDraftPreviews,
    assetTableOptions,
    canContinueAssetConfiguration,
    commitAssetDraftToOverview,
    detailAssetFields,
    detailAssets,
    moveAssetWizardToConfig,
    openAssetDetail,
    savingAssetDraft,
    showKnowledgeAssetsLoading,
    visibleKnowledgeBaseId,
  };
}

export default useKnowledgeAssetWorkbench;
