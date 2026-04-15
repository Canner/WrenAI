import { useMemo } from 'react';
import { ClientRuntimeScopeSelector } from '@/apollo/client/runtimeScope';
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
  snapshotCount?: number;
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

export default function useKnowledgeSidebarData<
  TKnowledgeBase extends KnowledgeBaseLike,
>({
  threads,
  onSelectThread,
  knowledgeBases,
  activeKnowledgeBase,
  knowledgeTab,
}: {
  threads: ThreadLike[];
  onSelectThread: (
    threadId: string,
    selector?: ClientRuntimeScopeSelector,
  ) => void;
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
        onClick: () => onSelectThread(thread.id, thread.selector),
      })),
    [onSelectThread, threads],
  );

  const kbList = useMemo<KnowledgeSidebarItem<TKnowledgeBase>[]>(() => {
    const baseList =
      knowledgeBases.length > 0
        ? knowledgeBases
        : activeKnowledgeBase
          ? [activeKnowledgeBase]
          : [];

    return baseList.map((kb) => {
      const displayName = getReferenceDisplayKnowledgeName(kb.name);
      return {
        id: kb.id,
        name: displayName,
        assetCount:
          getReferenceAssetCountByKnowledgeName(displayName) ??
          getReferenceAssetCountByKnowledgeName(kb.name) ??
          kb.snapshotCount,
        record: kb,
      };
    });
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
