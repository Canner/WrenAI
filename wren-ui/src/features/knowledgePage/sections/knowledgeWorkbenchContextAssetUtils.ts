import type { AssetView } from '@/features/knowledgePage/types';

export const resolveKnowledgeWorkbenchContextAsset = (
  detailAssets: AssetView[],
  contextAssetId?: string,
) => detailAssets.find((asset) => asset.id === contextAssetId) || null;

export const buildKnowledgeWorkbenchContextAssetOptions = (
  detailAssets: AssetView[],
) =>
  detailAssets.map((asset) => ({
    label: asset.name,
    value: asset.id,
  }));
