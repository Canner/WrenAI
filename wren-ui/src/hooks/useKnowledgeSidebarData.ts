import { useMemo } from 'react';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  getReferenceAssetCountByKnowledgeName,
  getReferenceDisplayKnowledgeName,
  getReferenceDisplayThreadTitle,
} from '@/utils/referenceDemoKnowledge';

type ThreadLike = {
  id: string;
  name?: string | null;
  selector?: ClientRuntimeScopeSelector;
};

type KnowledgeBaseLike = {
  id: string;
  name: string;
  kind?: string | null;
  sampleDataset?: string | null;
  slug?: string | null;
  snapshotCount?: number;
  assetCount?: number;
};

export type KnowledgeSidebarItem<TKnowledgeBase extends KnowledgeBaseLike> = {
  id: string;
  name: string;
  assetCount?: number;
  demo?: boolean;
  record?: TKnowledgeBase;
};

export const prioritizeKnowledgeSidebarItems = <
  TKnowledgeBase extends KnowledgeBaseLike,
>(
  items: KnowledgeSidebarItem<TKnowledgeBase>[],
  currentKnowledgeBaseId?: string | null,
) =>
  [...items]
    .sort((left, right) => {
      if (left.id === currentKnowledgeBaseId) {
        return -1;
      }
      if (right.id === currentKnowledgeBaseId) {
        return 1;
      }
      return String(left.name).localeCompare(String(right.name));
    })
    .slice(0, 4);

export const buildKnowledgeSidebarItems = <
  TKnowledgeBase extends KnowledgeBaseLike,
>(
  knowledgeBases: TKnowledgeBase[],
  activeKnowledgeBase?: TKnowledgeBase | null,
): KnowledgeSidebarItem<TKnowledgeBase>[] => {
  const baseList =
    knowledgeBases.length > 0
      ? knowledgeBases
      : activeKnowledgeBase
        ? [activeKnowledgeBase]
        : [];

  return baseList.map((kb) => {
    const displayName = getReferenceDisplayKnowledgeName(kb);
    return {
      id: kb.id,
      name: displayName,
      assetCount: getReferenceAssetCountByKnowledgeName(kb) ?? kb.assetCount,
      record: kb,
    };
  });
};

export default function useKnowledgeSidebarData<
  TKnowledgeBase extends KnowledgeBaseLike,
>({
  threads,
  knowledgeBases,
  activeKnowledgeBase,
  knowledgeTab,
}: {
  threads: ThreadLike[];
  knowledgeBases: TKnowledgeBase[];
  activeKnowledgeBase?: TKnowledgeBase | null;
  knowledgeTab: string;
}) {
  const historyItems = useMemo(
    () =>
      threads.map((thread) => ({
        id: thread.id,
        title: getReferenceDisplayThreadTitle(thread.name || ''),
        active: false,
        selector: thread.selector,
      })),
    [threads],
  );

  const kbList = useMemo<KnowledgeSidebarItem<TKnowledgeBase>[]>(() => {
    return buildKnowledgeSidebarItems(knowledgeBases, activeKnowledgeBase);
  }, [activeKnowledgeBase, knowledgeBases]);

  const visibleKnowledgeItems = useMemo(() => {
    if (knowledgeTab === 'recent') {
      return prioritizeKnowledgeSidebarItems(kbList, activeKnowledgeBase?.id);
    }

    return kbList;
  }, [activeKnowledgeBase?.id, kbList, knowledgeTab]);

  return {
    historyItems,
    kbList,
    visibleKnowledgeItems,
  };
}
