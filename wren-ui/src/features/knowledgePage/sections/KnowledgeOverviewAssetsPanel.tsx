import type { RefObject } from 'react';
import {
  AssetGalleryGrid,
  AssetsPanel,
  AssetsPanelBody,
} from '@/features/knowledgePage/index.styles';
import type { AssetView } from '@/features/knowledgePage/types';
import KnowledgeAssetCreateCard from './KnowledgeAssetCreateCard';
import KnowledgeAssetGalleryCard from './KnowledgeAssetGalleryCard';
import KnowledgeOverviewAssetsEmptyState from './KnowledgeOverviewAssetsEmptyState';
import KnowledgeOverviewAssetsLoadingOverlay from './KnowledgeOverviewAssetsLoadingOverlay';

type KnowledgeOverviewAssetsPanelProps = {
  detailAssets: AssetView[];
  renderedDetailAssets: AssetView[];
  activeDetailAsset?: AssetView | null;
  showKnowledgeAssetsLoading: boolean;
  hasMoreAssets: boolean;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  isReadonlyKnowledgeBase: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  isKnowledgeMutationDisabled: boolean;
  historicalSnapshotReadonlyHint: string;
  onOpenAssetWizard: () => void;
  onOpenAssetDetail: (asset: AssetView) => void;
};

export default function KnowledgeOverviewAssetsPanel({
  detailAssets,
  renderedDetailAssets,
  activeDetailAsset,
  showKnowledgeAssetsLoading,
  hasMoreAssets,
  loadMoreSentinelRef,
  isReadonlyKnowledgeBase,
  isSnapshotReadonlyKnowledgeBase,
  isKnowledgeMutationDisabled,
  historicalSnapshotReadonlyHint,
  onOpenAssetWizard,
  onOpenAssetDetail,
}: KnowledgeOverviewAssetsPanelProps) {
  return (
    <AssetsPanel>
      <AssetsPanelBody>
        {detailAssets.length > 0 ? (
          <AssetGalleryGrid>
            {!isKnowledgeMutationDisabled ? (
              <KnowledgeAssetCreateCard onOpenAssetWizard={onOpenAssetWizard} />
            ) : null}
            {renderedDetailAssets.map((asset) => (
              <KnowledgeAssetGalleryCard
                key={asset.id}
                asset={asset}
                active={asset.id === activeDetailAsset?.id}
                onOpenAssetDetail={onOpenAssetDetail}
              />
            ))}
            {hasMoreAssets ? (
              <div
                ref={loadMoreSentinelRef}
                style={{ width: '100%', height: 1, gridColumn: '1 / -1' }}
                aria-hidden
              />
            ) : null}
          </AssetGalleryGrid>
        ) : (
          <KnowledgeOverviewAssetsEmptyState
            isReadonlyKnowledgeBase={isReadonlyKnowledgeBase}
            isSnapshotReadonlyKnowledgeBase={isSnapshotReadonlyKnowledgeBase}
            isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
            historicalSnapshotReadonlyHint={historicalSnapshotReadonlyHint}
            onOpenAssetWizard={onOpenAssetWizard}
          />
        )}

        {showKnowledgeAssetsLoading ? (
          <KnowledgeOverviewAssetsLoadingOverlay />
        ) : null}
      </AssetsPanelBody>
    </AssetsPanel>
  );
}
