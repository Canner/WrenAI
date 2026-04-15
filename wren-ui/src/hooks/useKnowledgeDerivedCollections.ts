import { useMemo } from 'react';
import {
  resolveVisibleKnowledgeBaseId,
  shouldShowKnowledgeAssetsLoading,
} from './useKnowledgePageHelpers';
import { resolveWizardPreviewAssets } from './useKnowledgeAssetWizard';

type AssetLike = {
  id: string;
  name: string;
  description?: string | null;
  kind: 'model' | 'view';
  fieldCount: number;
  owner?: string | null;
  sourceTableName?: string | null;
  sourceSql?: string | null;
  primaryKey?: string | null;
  cached?: boolean;
  refreshTime?: string | null;
  relationCount?: number;
  nestedFieldCount?: number;
  suggestedQuestions?: string[];
  relationFields?: Array<{
    key: string;
    displayName: string;
    type?: string | null;
    modelName?: string | null;
    columnName?: string | null;
    note?: string | null;
  }>;
  fields: Array<{
    key: string;
    fieldName: string;
    fieldType?: string | null;
    aiName?: string | null;
    note?: string | null;
    isPrimaryKey?: boolean;
    isCalculated?: boolean;
    aggregation?: string | null;
    lineage?: number[] | null;
    nestedFields?: Array<{
      id: string;
      referenceName: string;
      displayName?: string | null;
      columnPath?: string[] | null;
      type?: string | null;
      description?: string | null;
    }> | null;
  }>;
};

type DemoKnowledgeLike = {
  id: string;
  name: string;
  description: string;
  assetName: string;
  owner: string;
  fields: Array<{
    key: string;
    fieldName: string;
    fieldType?: string | null;
    aiName?: string | null;
    note?: string | null;
    isPrimaryKey?: boolean;
    isCalculated?: boolean;
    aggregation?: string | null;
    lineage?: number[] | null;
    nestedFields?: Array<{
      id: string;
      referenceName: string;
      displayName?: string | null;
      columnPath?: string[] | null;
      type?: string | null;
      description?: string | null;
    }> | null;
  }>;
  suggestedQuestions: string[];
};

export const resolveDetailAssets = <TAsset>({
  assets,
  overviewPreviewAsset,
}: {
  assets: TAsset[];
  overviewPreviewAsset?: TAsset | null;
}): TAsset[] => {
  if (assets.length > 0) {
    return assets;
  }

  return overviewPreviewAsset ? [overviewPreviewAsset] : [];
};

export default function useKnowledgeDerivedCollections({
  assets,
  selectedDemoKnowledge,
  activeKnowledgeBaseId,
  pendingKnowledgeBaseId,
  overviewPreviewAsset,
  activeKnowledgeBaseUsesRuntime,
  diagramLoading,
  hasDiagramData,
  routeRuntimeSyncing,
}: {
  assets: AssetLike[];
  selectedDemoKnowledge?: DemoKnowledgeLike | null;
  activeKnowledgeBaseId?: string | null;
  pendingKnowledgeBaseId?: string | null;
  overviewPreviewAsset?: AssetLike | null;
  activeKnowledgeBaseUsesRuntime: boolean;
  diagramLoading: boolean;
  hasDiagramData: boolean;
  routeRuntimeSyncing: boolean;
}) {
  const wizardPreviewAssets = useMemo<AssetLike[]>(
    () =>
      resolveWizardPreviewAssets({
        assets,
        selectedDemoKnowledge,
      }),
    [assets, selectedDemoKnowledge],
  );
  const visibleKnowledgeBaseId = useMemo(
    () =>
      resolveVisibleKnowledgeBaseId({
        activeKnowledgeBaseId,
        pendingKnowledgeBaseId,
      }),
    [activeKnowledgeBaseId, pendingKnowledgeBaseId],
  );
  const detailAssets = useMemo(
    () =>
      resolveDetailAssets({
        assets,
        overviewPreviewAsset,
      }),
    [assets, overviewPreviewAsset],
  );
  const showKnowledgeAssetsLoading = useMemo(
    () =>
      shouldShowKnowledgeAssetsLoading({
        activeKnowledgeBaseUsesRuntime,
        assetCount: detailAssets.length,
        diagramLoading,
        hasDiagramData,
        routeRuntimeSyncing,
      }),
    [
      activeKnowledgeBaseUsesRuntime,
      detailAssets.length,
      diagramLoading,
      hasDiagramData,
      routeRuntimeSyncing,
    ],
  );

  return {
    wizardPreviewAssets,
    visibleKnowledgeBaseId,
    detailAssets,
    showKnowledgeAssetsLoading,
  };
}
