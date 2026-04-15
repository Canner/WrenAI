import { useMemo } from 'react';
import type { RuntimeSelectorState } from '@/hooks/useRuntimeSelectorState';

export type KnowledgeSelectorFallback = {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: null;
  defaultKbSnapshotId: string | null;
  createdBy: null;
  createdAt: null;
  updatedAt: null;
  snapshotCount: number;
  defaultKbSnapshot: {
    id: string;
    displayName: string;
    deployHash: string;
    status: string;
  } | null;
};

export const resolveKnowledgeSelectorFallback = ({
  runtimeSelectorState,
  routeKnowledgeBaseId,
  effectiveWorkspaceId,
  currentWorkspaceId,
  routeKbSnapshotId,
  currentKbSnapshotId,
}: {
  runtimeSelectorState: RuntimeSelectorState | null;
  routeKnowledgeBaseId?: string | null;
  effectiveWorkspaceId?: string;
  currentWorkspaceId?: string;
  routeKbSnapshotId?: string | null;
  currentKbSnapshotId?: string | null;
}): KnowledgeSelectorFallback | null => {
  const selectorKnowledgeBase = runtimeSelectorState?.currentKnowledgeBase;
  if (!selectorKnowledgeBase?.id && !routeKnowledgeBaseId) {
    return null;
  }

  return {
    id: routeKnowledgeBaseId || selectorKnowledgeBase?.id || '',
    workspaceId: effectiveWorkspaceId || currentWorkspaceId || '',
    slug: routeKnowledgeBaseId || selectorKnowledgeBase?.id || '',
    name: selectorKnowledgeBase?.name || '知识库',
    description: null,
    defaultKbSnapshotId: routeKbSnapshotId || currentKbSnapshotId || null,
    createdBy: null,
    createdAt: null,
    updatedAt: null,
    snapshotCount: 0,
    defaultKbSnapshot: runtimeSelectorState?.currentKbSnapshot
      ? {
          id: runtimeSelectorState.currentKbSnapshot.id,
          displayName: runtimeSelectorState.currentKbSnapshot.displayName,
          deployHash: runtimeSelectorState.currentKbSnapshot.deployHash,
          status: runtimeSelectorState.currentKbSnapshot.status,
        }
      : null,
  };
};

export default function useKnowledgeSelectorFallback({
  runtimeSelectorState,
  routeKnowledgeBaseId,
  effectiveWorkspaceId,
  currentWorkspaceId,
  routeKbSnapshotId,
  currentKbSnapshotId,
}: {
  runtimeSelectorState: RuntimeSelectorState | null;
  routeKnowledgeBaseId?: string | null;
  effectiveWorkspaceId?: string;
  currentWorkspaceId?: string;
  routeKbSnapshotId?: string | null;
  currentKbSnapshotId?: string | null;
}) {
  return useMemo(
    () =>
      resolveKnowledgeSelectorFallback({
        runtimeSelectorState,
        routeKnowledgeBaseId,
        effectiveWorkspaceId,
        currentWorkspaceId,
        routeKbSnapshotId,
        currentKbSnapshotId,
      }),
    [
      currentKbSnapshotId,
      currentWorkspaceId,
      effectiveWorkspaceId,
      routeKbSnapshotId,
      routeKnowledgeBaseId,
      runtimeSelectorState?.currentKbSnapshot,
      runtimeSelectorState?.currentKnowledgeBase,
    ],
  );
}
