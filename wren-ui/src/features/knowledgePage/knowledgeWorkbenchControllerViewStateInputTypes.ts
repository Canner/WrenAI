import useKnowledgeWorkbenchViewState from './useKnowledgeWorkbenchViewState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchControllerViewStateInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = {
  activeKnowledgeBase?: TKnowledgeBase | null;
  activeKnowledgeBaseExecutable: boolean;
  activeKnowledgeSnapshotId?: string | null;
  assetDraft: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['assetDraft'];
  assets: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['assets'];
  buildRuntimeScopeUrl: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['buildRuntimeScopeUrl'];
  connectors: TConnector[];
  currentKnowledgeBaseId?: string | null;
  demoDatabaseOptions: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['demoDatabaseOptions'];
  demoTableOptions: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['demoTableOptions'];
  detailAsset: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['detailAsset'];
  detailFieldFilter: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['detailFieldFilter'];
  detailFieldKeyword: string;
  diagramData: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['diagramData'];
  diagramLoading: boolean;
  hasRuntimeScope: boolean;
  isDemoSource: boolean;
  knowledgeBases: TKnowledgeBase[];
  knowledgeOwner?: string | null;
  knowledgeTab: string;
  overviewPreviewAsset: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['overviewPreviewAsset'];
  pendingKnowledgeBaseId?: string | null;
  replaceWorkspace: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['replaceWorkspace'];
  resetAssetDraft: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['resetAssetDraft'];
  resetDetailViewState: () => void;
  routeKnowledgeBaseId?: string | null;
  routeRuntimeSyncing: boolean;
  routerQuery: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['routerQuery'];
  selectedConnectorId?: string;
  selectedDemoKnowledge: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['selectedDemoKnowledge'];
  selectedDemoTable?: string;
  setAssetDraft: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['setAssetDraft'];
  setAssetModalOpen: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['setAssetModalOpen'];
  setAssetWizardStep: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['setAssetWizardStep'];
  setDetailAsset: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['setDetailAsset'];
  setDraftAssets: Parameters<
    typeof useKnowledgeWorkbenchViewState<TKnowledgeBase, TConnector>
  >[0]['setDraftAssets'];
  setPendingKnowledgeBaseId: (id: string | null) => void;
  setSelectedConnectorId: (id?: string) => void;
  setSelectedDemoTable: (table?: string) => void;
  setSelectedKnowledgeBaseId: (id: string | null) => void;
};
