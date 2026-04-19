import useKnowledgeAssetWorkbench from './useKnowledgeAssetWorkbench';
import useKnowledgeWorkbenchNavigationState from './useKnowledgeWorkbenchNavigationState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchPresentationStateArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = {
  activeKnowledgeBase?: TKnowledgeBase | null;
  activeKnowledgeBaseExecutable: boolean;
  assetDraft: Parameters<typeof useKnowledgeAssetWorkbench>[0]['assetDraft'];
  assets: Parameters<typeof useKnowledgeAssetWorkbench>[0]['assets'];
  buildKnowledgeRuntimeSelector: Parameters<
    typeof useKnowledgeWorkbenchNavigationState<TKnowledgeBase>
  >[0]['buildKnowledgeRuntimeSelector'];
  buildRuntimeScopeUrl: Parameters<
    typeof useKnowledgeWorkbenchNavigationState<TKnowledgeBase>
  >[0]['buildRuntimeScopeUrl'];
  connectors: TConnector[];
  demoDatabaseOptions: Parameters<
    typeof useKnowledgeAssetWorkbench
  >[0]['demoDatabaseOptions'];
  demoTableOptions: Parameters<
    typeof useKnowledgeAssetWorkbench
  >[0]['demoTableOptions'];
  detailAsset?: Parameters<typeof useKnowledgeAssetWorkbench>[0]['detailAsset'];
  detailFieldFilter: Parameters<
    typeof useKnowledgeAssetWorkbench
  >[0]['detailFieldFilter'];
  detailFieldKeyword: string;
  diagramData?: Parameters<typeof useKnowledgeAssetWorkbench>[0]['diagramData'];
  diagramLoading: boolean;
  isDemoSource: boolean;
  knowledgeBases: TKnowledgeBase[];
  knowledgeOwner?: string | null;
  knowledgeTab: string;
  openAssetWizard: () => void;
  overviewPreviewAsset?: Parameters<
    typeof useKnowledgeAssetWorkbench
  >[0]['overviewPreviewAsset'];
  pendingKnowledgeBaseId?: string | null;
  replaceWorkspace: Parameters<
    typeof useKnowledgeWorkbenchNavigationState<TKnowledgeBase>
  >[0]['replaceWorkspace'];
  resetDetailViewState: () => void;
  routeRuntimeSyncing: boolean;
  routerQuery: Parameters<
    typeof useKnowledgeWorkbenchNavigationState<TKnowledgeBase>
  >[0]['routerQuery'];
  selectedConnectorId?: string;
  selectedDemoKnowledge?: Parameters<
    typeof useKnowledgeAssetWorkbench
  >[0]['selectedDemoKnowledge'];
  selectedDemoTable?: string;
  setAssetDraft: Parameters<
    typeof useKnowledgeAssetWorkbench
  >[0]['setAssetDraft'];
  setAssetWizardStep: Parameters<
    typeof useKnowledgeAssetWorkbench
  >[0]['setAssetWizardStep'];
  setDetailAsset: Parameters<
    typeof useKnowledgeWorkbenchNavigationState<TKnowledgeBase>
  >[0]['setDetailAsset'];
  setDraftAssets: Parameters<
    typeof useKnowledgeAssetWorkbench
  >[0]['setDraftAssets'];
};
