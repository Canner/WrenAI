import type { RefObject } from 'react';
import type { KnowledgeDetailFieldFilter } from '@/hooks/useKnowledgeAssetDetail';
import type { AssetView } from '@/features/knowledgePage/types';
import type {
  KnowledgeAssetDetailField,
  KnowledgeWorkbenchDetailTab,
  KnowledgeWorkbenchModelingSummary,
} from './knowledgeWorkbenchShared';
import KnowledgeAssetDetailDrawer from './KnowledgeAssetDetailDrawer';
import KnowledgeOverviewAssetsPanel from './KnowledgeOverviewAssetsPanel';
import KnowledgeOverviewStats from './KnowledgeOverviewStats';

type KnowledgeOverviewSectionProps = {
  previewFieldCount: number;
  detailAssets: AssetView[];
  renderedDetailAssets: AssetView[];
  activeDetailAsset?: AssetView | null;
  detailTab: KnowledgeWorkbenchDetailTab;
  detailFieldKeyword: string;
  detailFieldFilter: KnowledgeDetailFieldFilter;
  detailAssetFields: KnowledgeAssetDetailField[];
  sqlListCount: number;
  ruleListCount: number;
  modelingSummary?: KnowledgeWorkbenchModelingSummary;
  showKnowledgeAssetsLoading: boolean;
  hasMoreAssets: boolean;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  isReadonlyKnowledgeBase: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  isKnowledgeMutationDisabled: boolean;
  historicalSnapshotReadonlyHint: string;
  onOpenAssetWizard: () => void;
  onOpenAssetDetail: (asset: AssetView) => void;
  onCloseAssetDetail: () => void;
  onOpenModeling: () => void;
  onCreateRuleDraft?: (asset: AssetView) => void;
  onCreateSqlTemplateDraft?: (asset: AssetView) => void;
  onChangeDetailTab: (tab: KnowledgeWorkbenchDetailTab) => void;
  onChangeFieldKeyword: (keyword: string) => void;
  onChangeFieldFilter: (filter: KnowledgeDetailFieldFilter) => void;
};

export default function KnowledgeOverviewSection({
  previewFieldCount,
  detailAssets,
  renderedDetailAssets,
  activeDetailAsset,
  detailTab,
  detailFieldKeyword,
  detailFieldFilter,
  detailAssetFields,
  sqlListCount,
  ruleListCount,
  modelingSummary,
  showKnowledgeAssetsLoading,
  hasMoreAssets,
  loadMoreSentinelRef,
  isReadonlyKnowledgeBase,
  isSnapshotReadonlyKnowledgeBase,
  isKnowledgeMutationDisabled,
  historicalSnapshotReadonlyHint,
  onOpenAssetWizard,
  onOpenAssetDetail,
  onCloseAssetDetail,
  onOpenModeling,
  onCreateRuleDraft,
  onCreateSqlTemplateDraft,
  onChangeDetailTab,
  onChangeFieldKeyword,
  onChangeFieldFilter,
}: KnowledgeOverviewSectionProps) {
  return (
    <>
      <KnowledgeOverviewStats
        previewFieldCount={previewFieldCount}
        detailAssetsCount={detailAssets.length}
        sqlListCount={sqlListCount}
        ruleListCount={ruleListCount}
        modelingSummary={modelingSummary}
      />

      <KnowledgeOverviewAssetsPanel
        detailAssets={detailAssets}
        renderedDetailAssets={renderedDetailAssets}
        activeDetailAsset={activeDetailAsset}
        showKnowledgeAssetsLoading={showKnowledgeAssetsLoading}
        hasMoreAssets={hasMoreAssets}
        loadMoreSentinelRef={loadMoreSentinelRef}
        isReadonlyKnowledgeBase={isReadonlyKnowledgeBase}
        isSnapshotReadonlyKnowledgeBase={isSnapshotReadonlyKnowledgeBase}
        isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
        historicalSnapshotReadonlyHint={historicalSnapshotReadonlyHint}
        onOpenAssetWizard={onOpenAssetWizard}
        onOpenAssetDetail={onOpenAssetDetail}
      />

      <KnowledgeAssetDetailDrawer
        activeDetailAsset={activeDetailAsset}
        detailTab={detailTab}
        detailFieldKeyword={detailFieldKeyword}
        detailFieldFilter={detailFieldFilter}
        detailAssetFields={detailAssetFields}
        canCreateKnowledgeArtifacts={!isKnowledgeMutationDisabled}
        onCloseAssetDetail={onCloseAssetDetail}
        onOpenModeling={onOpenModeling}
        onCreateRuleDraft={onCreateRuleDraft}
        onCreateSqlTemplateDraft={onCreateSqlTemplateDraft}
        onChangeDetailTab={onChangeDetailTab}
        onChangeFieldKeyword={onChangeFieldKeyword}
        onChangeFieldFilter={onChangeFieldFilter}
      />
    </>
  );
}
