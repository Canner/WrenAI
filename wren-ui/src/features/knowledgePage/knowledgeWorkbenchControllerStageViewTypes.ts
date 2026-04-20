import type { AssetView } from './types';

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
  handleChangeWorkbenchSection: any;
  handleCloseAssetDetail: () => void;
  handleNavigateModeling: () => void;
  handleOpenAssetWizard: () => void;
  moveAssetWizardToConfig: () => void;
  openAssetDetail: any;
  savingAssetDraft: boolean;
  showKnowledgeAssetsLoading: boolean;
  visibleKnowledgeBaseId: string | null;
  visibleKnowledgeItems: any[];
};
