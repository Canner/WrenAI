import type { AssetView } from './types';

export type ModelingAssistantIntent = 'relationships' | 'semantics';

export type ViewStateInput = {
  activeDetailAsset: AssetView | null;
  activeWorkbenchSection: any;
  assetDatabaseOptions: Array<any>;
  assetDraftPreview: AssetView | null;
  assetDraftPreviews: AssetView[];
  assetTableOptions: Array<any>;
  buildKnowledgeSwitchUrl: (...args: any[]) => string;
  canContinueAssetConfiguration: boolean;
  commitAssetDraftToOverview: () => Promise<void> | void;
  detailAssetFields: any[];
  detailAssets: AssetView[];
  finalizePersistedRuntimeScope?: () => Promise<unknown> | unknown;
  handleChangeWorkbenchSection: any;
  handleCloseAssetDetail: () => void;
  handleNavigateModeling: (intent?: ModelingAssistantIntent) => void;
  handleOpenAssetWizard: () => void;
  loadConnectors?: () => Promise<unknown> | unknown;
  moveAssetWizardToConfig: () => void;
  navigateModelingWithPersistedRuntimeScope?: (
    intent?: ModelingAssistantIntent,
  ) => Promise<unknown> | unknown;
  openAssetDetail: any;
  persistedAssetDraftPreviews?: AssetView[];
  recommendationRuntimeSelector?: any;
  refreshAssets?: () => Promise<unknown> | unknown;
  savingAssetDraft: boolean;
  showKnowledgeAssetsLoading: boolean;
  visibleKnowledgeBaseId: string | null;
  visibleKnowledgeItems: any[];
};
