import useKnowledgeAssets from '@/hooks/useKnowledgeAssets';
import useKnowledgeConnectors from '@/hooks/useKnowledgeConnectors';
import useKnowledgeDiagramData from '@/hooks/useKnowledgeDiagramData';
import useKnowledgeRuntimeDataSync from '@/hooks/useKnowledgeRuntimeDataSync';
import buildKnowledgeWorkbenchAssetsInputs from './buildKnowledgeWorkbenchAssetsInputs';
import buildKnowledgeWorkbenchConnectorsInputs from './buildKnowledgeWorkbenchConnectorsInputs';
import buildKnowledgeWorkbenchDiagramInputs from './buildKnowledgeWorkbenchDiagramInputs';
import buildKnowledgeWorkbenchRuntimeDataSyncInputs from './buildKnowledgeWorkbenchRuntimeDataSyncInputs';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchContentDataArgs } from './knowledgeWorkbenchContentDataTypes';

export function useKnowledgeWorkbenchContentData<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(args: KnowledgeWorkbenchContentDataArgs<TKnowledgeBase, TConnector>) {
  const {
    connectors,
    connectorsLoading,
    selectedSourceType,
    setSelectedSourceType,
    selectedConnectorId,
    setSelectedConnectorId,
    selectedDemoTable,
    setSelectedDemoTable,
    selectedDemoKnowledge,
    isDemoSource,
    demoDatabaseOptions,
    demoTableOptions,
    canContinueAssetWizard,
  } = useKnowledgeConnectors<TConnector>(
    buildKnowledgeWorkbenchConnectorsInputs(args),
  );

  const { diagramData, diagramLoading, refetchDiagram } =
    useKnowledgeDiagramData(buildKnowledgeWorkbenchDiagramInputs(args));

  const { routeRuntimeSyncing: routeRuntimeDataSyncing } =
    useKnowledgeRuntimeDataSync(
      buildKnowledgeWorkbenchRuntimeDataSyncInputs(args, {
        refetchDiagram,
      }),
    );

  const { assets, overviewPreviewAsset, previewFieldCount } =
    useKnowledgeAssets(
      buildKnowledgeWorkbenchAssetsInputs(args, {
        diagramData,
      }),
    );

  const effectiveCanContinueAssetWizard = canContinueAssetWizard;

  return {
    assets,
    canContinueAssetWizard: effectiveCanContinueAssetWizard,
    connectors,
    connectorsLoading,
    demoDatabaseOptions,
    demoTableOptions,
    diagramData,
    diagramLoading,
    isDemoSource,
    overviewPreviewAsset,
    previewFieldCount,
    refetchDiagram,
    routeRuntimeSyncing: args.runtimeTransitioning || routeRuntimeDataSyncing,
    selectedConnectorId,
    selectedDemoKnowledge,
    selectedDemoTable,
    selectedSourceType,
    setSelectedConnectorId,
    setSelectedDemoTable,
    setSelectedSourceType,
  };
}

export default useKnowledgeWorkbenchContentData;
