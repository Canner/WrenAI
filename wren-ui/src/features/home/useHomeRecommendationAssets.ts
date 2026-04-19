import { useMemo } from 'react';
import useKnowledgeAssets from '@/hooks/useKnowledgeAssets';
import useKnowledgeDiagramData from '@/hooks/useKnowledgeDiagramData';
import { getReferenceDemoKnowledgeByName } from '@/utils/referenceDemoKnowledge';
import type { RuntimeSelectorState } from '@/hooks/useRuntimeSelectorState';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';

type KnowledgeBaseSummary = NonNullable<
  RuntimeSelectorState['knowledgeBases']
>[number];

const resolveRecommendationKnowledgeBase = ({
  currentKnowledgeBases,
  currentKnowledgeBase,
  selectedKnowledgeBaseIds,
}: {
  currentKnowledgeBases: KnowledgeBaseSummary[];
  currentKnowledgeBase?: RuntimeSelectorState['currentKnowledgeBase'];
  selectedKnowledgeBaseIds: string[];
}) => {
  if (selectedKnowledgeBaseIds.length > 0) {
    const selectedKnowledgeBase = currentKnowledgeBases.find(
      (knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseIds[0],
    );
    if (selectedKnowledgeBase) {
      return selectedKnowledgeBase;
    }
  }

  return currentKnowledgeBase || null;
};

export default function useHomeRecommendationAssets({
  hasRuntimeScope,
  hasExecutableAskRuntime,
  currentKnowledgeBases,
  currentKnowledgeBase,
  currentKbSnapshot,
  selectedKnowledgeBaseIds,
  currentSelector,
}: {
  hasRuntimeScope: boolean;
  hasExecutableAskRuntime: boolean;
  currentKnowledgeBases: KnowledgeBaseSummary[];
  currentKnowledgeBase?: RuntimeSelectorState['currentKnowledgeBase'];
  currentKbSnapshot?: RuntimeSelectorState['currentKbSnapshot'];
  selectedKnowledgeBaseIds: string[];
  currentSelector: ClientRuntimeScopeSelector;
}) {
  const recommendationKnowledgeBase = useMemo(
    () =>
      resolveRecommendationKnowledgeBase({
        currentKnowledgeBases,
        currentKnowledgeBase,
        selectedKnowledgeBaseIds,
      }),
    [currentKnowledgeBase, currentKnowledgeBases, selectedKnowledgeBaseIds],
  );

  const recommendationKbSnapshotId = useMemo(() => {
    if (!recommendationKnowledgeBase?.id) {
      return undefined;
    }

    if (recommendationKnowledgeBase.id === currentKnowledgeBase?.id) {
      return currentKbSnapshot?.id || currentSelector.kbSnapshotId;
    }

    return recommendationKnowledgeBase.defaultKbSnapshotId || undefined;
  }, [
    currentKbSnapshot?.id,
    currentKnowledgeBase?.id,
    currentSelector.kbSnapshotId,
    recommendationKnowledgeBase,
  ]);

  const recommendationSelector = useMemo(
    () => ({
      ...(currentSelector.workspaceId
        ? { workspaceId: currentSelector.workspaceId }
        : {}),
      ...(recommendationKnowledgeBase?.id
        ? { knowledgeBaseId: recommendationKnowledgeBase.id }
        : currentSelector.knowledgeBaseId
          ? { knowledgeBaseId: currentSelector.knowledgeBaseId }
          : {}),
      ...(recommendationKbSnapshotId
        ? { kbSnapshotId: recommendationKbSnapshotId }
        : {}),
      ...(recommendationKnowledgeBase?.id === currentKnowledgeBase?.id &&
      currentSelector.deployHash
        ? { deployHash: currentSelector.deployHash }
        : {}),
      ...(currentSelector.runtimeScopeId
        ? { runtimeScopeId: currentSelector.runtimeScopeId }
        : {}),
    }),
    [
      currentKnowledgeBase?.id,
      currentSelector.deployHash,
      currentSelector.knowledgeBaseId,
      currentSelector.kbSnapshotId,
      currentSelector.runtimeScopeId,
      currentSelector.workspaceId,
      recommendationKbSnapshotId,
      recommendationKnowledgeBase?.id,
    ],
  );

  const { diagramData } = useKnowledgeDiagramData({
    hasRuntimeScope: hasRuntimeScope && hasExecutableAskRuntime,
    routeKnowledgeBaseId: recommendationKnowledgeBase?.id,
    routeKbSnapshotId: recommendationKbSnapshotId,
    effectiveRuntimeSelector: recommendationSelector,
  });

  const matchedDemoKnowledge = useMemo(
    () => getReferenceDemoKnowledgeByName(recommendationKnowledgeBase?.name),
    [recommendationKnowledgeBase?.name],
  );

  const { assets, overviewPreviewAsset } = useKnowledgeAssets({
    activeKnowledgeBaseName: recommendationKnowledgeBase?.name,
    hasActiveKnowledgeBase: Boolean(recommendationKnowledgeBase),
    activeKnowledgeBaseUsesRuntime: Boolean(recommendationKbSnapshotId),
    diagramData,
    draftAssets: [],
    knowledgeOwner: null,
    matchedDemoKnowledge,
  });

  const recommendationAssets = useMemo(
    () =>
      assets.length > 0
        ? assets
        : overviewPreviewAsset
          ? [overviewPreviewAsset]
          : [],
    [assets, overviewPreviewAsset],
  );

  return {
    recommendationAssets,
  };
}
