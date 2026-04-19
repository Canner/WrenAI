import type { KnowledgeDetailFieldFilter } from '@/hooks/useKnowledgeAssetDetail';
import type { AssetView } from '@/features/knowledgePage/types';

import type {
  KnowledgeAssetDetailField,
  KnowledgeWorkbenchDetailTab,
  KnowledgeWorkbenchModelingSummary,
  KnowledgeWorkbenchSectionKey,
} from './knowledgeWorkbenchShared';
import KnowledgeOverviewSection from './KnowledgeOverviewSection';
import { useKnowledgeWorkbenchAssetGallery } from './useKnowledgeWorkbenchAssetGallery';

export type KnowledgeOverviewStageProps = {
  activeDetailAsset?: AssetView | null;
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  detailAssetFields: KnowledgeAssetDetailField[];
  detailAssets: AssetView[];
  detailFieldFilter: KnowledgeDetailFieldFilter;
  detailFieldKeyword: string;
  detailTab: KnowledgeWorkbenchDetailTab;
  historicalSnapshotReadonlyHint: string;
  isKnowledgeMutationDisabled: boolean;
  isReadonlyKnowledgeBase: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  modelingSummary?: KnowledgeWorkbenchModelingSummary;
  onChangeDetailTab: (tab: KnowledgeWorkbenchDetailTab) => void;
  onChangeFieldFilter: (filter: KnowledgeDetailFieldFilter) => void;
  onChangeFieldKeyword: (keyword: string) => void;
  onCloseAssetDetail: () => void;
  onCreateRuleDraft?: (asset: AssetView) => void;
  onCreateSqlTemplateDraft?: (asset: AssetView) => void;
  onOpenAssetDetail: (asset: AssetView) => void;
  onOpenAssetWizard: () => void;
  onOpenModeling: () => void;
  previewFieldCount: number;
  ruleListCount: number;
  showKnowledgeAssetsLoading: boolean;
  sqlListCount: number;
};

export default function KnowledgeOverviewStage({
  activeDetailAsset,
  activeWorkbenchSection,
  detailAssetFields,
  detailAssets,
  detailFieldFilter,
  detailFieldKeyword,
  detailTab,
  historicalSnapshotReadonlyHint,
  isKnowledgeMutationDisabled,
  isReadonlyKnowledgeBase,
  isSnapshotReadonlyKnowledgeBase,
  modelingSummary,
  onChangeDetailTab,
  onChangeFieldFilter,
  onChangeFieldKeyword,
  onCloseAssetDetail,
  onCreateRuleDraft,
  onCreateSqlTemplateDraft,
  onOpenAssetDetail,
  onOpenAssetWizard,
  onOpenModeling,
  previewFieldCount,
  ruleListCount,
  showKnowledgeAssetsLoading,
  sqlListCount,
}: KnowledgeOverviewStageProps) {
  const {
    hasMoreAssets,
    loadMoreSentinelRef,
    renderedDetailAssets,
    showAssetWorkbench,
  } = useKnowledgeWorkbenchAssetGallery({
    activeDetailAsset,
    activeWorkbenchSection,
    detailAssets,
    onCloseAssetDetail,
  });

  if (!showAssetWorkbench) {
    return null;
  }

  return (
    <KnowledgeOverviewSection
      activeDetailAsset={activeDetailAsset}
      detailAssetFields={detailAssetFields}
      detailAssets={detailAssets}
      detailFieldFilter={detailFieldFilter}
      detailFieldKeyword={detailFieldKeyword}
      detailTab={detailTab}
      hasMoreAssets={hasMoreAssets}
      historicalSnapshotReadonlyHint={historicalSnapshotReadonlyHint}
      isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
      isReadonlyKnowledgeBase={isReadonlyKnowledgeBase}
      isSnapshotReadonlyKnowledgeBase={isSnapshotReadonlyKnowledgeBase}
      loadMoreSentinelRef={loadMoreSentinelRef}
      modelingSummary={modelingSummary}
      previewFieldCount={previewFieldCount}
      renderedDetailAssets={renderedDetailAssets}
      ruleListCount={ruleListCount}
      showKnowledgeAssetsLoading={showKnowledgeAssetsLoading}
      sqlListCount={sqlListCount}
      onChangeDetailTab={onChangeDetailTab}
      onChangeFieldFilter={onChangeFieldFilter}
      onChangeFieldKeyword={onChangeFieldKeyword}
      onCloseAssetDetail={onCloseAssetDetail}
      onCreateRuleDraft={onCreateRuleDraft}
      onCreateSqlTemplateDraft={onCreateSqlTemplateDraft}
      onOpenAssetDetail={onOpenAssetDetail}
      onOpenAssetWizard={onOpenAssetWizard}
      onOpenModeling={onOpenModeling}
    />
  );
}
