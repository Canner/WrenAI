import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetView } from '@/features/knowledgePage/types';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

const ASSET_GALLERY_INITIAL_RENDER_COUNT = 24;
const ASSET_GALLERY_RENDER_BATCH = 24;

export function useKnowledgeWorkbenchAssetGallery({
  activeDetailAsset,
  activeWorkbenchSection,
  detailAssets,
  onCloseAssetDetail,
}: {
  activeDetailAsset?: AssetView | null;
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  detailAssets: AssetView[];
  onCloseAssetDetail: () => void;
}) {
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const [assetRenderLimit, setAssetRenderLimit] = useState(
    ASSET_GALLERY_INITIAL_RENDER_COUNT,
  );

  useEffect(() => {
    setAssetRenderLimit(ASSET_GALLERY_INITIAL_RENDER_COUNT);
  }, [detailAssets.length]);

  useEffect(() => {
    if (!activeDetailAsset) {
      return;
    }

    const activeIndex = detailAssets.findIndex(
      (asset) => asset.id === activeDetailAsset.id,
    );
    if (activeIndex < 0) {
      return;
    }

    const requiredLimit = Math.min(
      detailAssets.length,
      activeIndex + ASSET_GALLERY_RENDER_BATCH,
    );
    setAssetRenderLimit((currentLimit) =>
      currentLimit >= requiredLimit ? currentLimit : requiredLimit,
    );
  }, [activeDetailAsset?.id, detailAssets]);

  useEffect(() => {
    if (activeDetailAsset && activeWorkbenchSection !== 'overview') {
      onCloseAssetDetail();
    }
  }, [activeDetailAsset, activeWorkbenchSection, onCloseAssetDetail]);

  const renderedDetailAssets = useMemo(
    () => detailAssets.slice(0, assetRenderLimit),
    [assetRenderLimit, detailAssets],
  );
  const hasMoreAssets = assetRenderLimit < detailAssets.length;

  useEffect(() => {
    if (!hasMoreAssets) {
      return;
    }

    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) {
          return;
        }

        setAssetRenderLimit((currentLimit) =>
          Math.min(
            detailAssets.length,
            currentLimit + ASSET_GALLERY_RENDER_BATCH,
          ),
        );
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [detailAssets.length, hasMoreAssets]);

  return {
    hasMoreAssets,
    loadMoreSentinelRef,
    renderedDetailAssets,
    showAssetWorkbench: activeWorkbenchSection === 'overview',
  };
}
