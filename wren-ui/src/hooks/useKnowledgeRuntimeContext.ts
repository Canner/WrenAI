import { useMemo } from 'react';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { readRuntimeScopeSelectorFromObject } from '@/runtime/client/runtimeScope';
import type { RuntimeSelectorState } from '@/hooks/useRuntimeSelectorState';

type RouterQueryLike = Record<string, string | string[] | undefined>;

export const resolveKnowledgeEffectiveRuntimeSelector = ({
  routeRuntimeSelector,
  currentWorkspaceId,
  currentKnowledgeBaseId,
  currentKbSnapshotId,
  currentKbSnapshotDeployHash,
}: {
  routeRuntimeSelector: ClientRuntimeScopeSelector;
  currentWorkspaceId?: string;
  currentKnowledgeBaseId?: string;
  currentKbSnapshotId?: string;
  currentKbSnapshotDeployHash?: string;
}): ClientRuntimeScopeSelector => {
  const routeKnowledgeBaseId = routeRuntimeSelector.knowledgeBaseId;
  const shouldReuseCurrentSnapshot =
    !routeKnowledgeBaseId || routeKnowledgeBaseId === currentKnowledgeBaseId;

  return {
    workspaceId:
      routeRuntimeSelector.workspaceId || currentWorkspaceId || undefined,
    knowledgeBaseId:
      routeKnowledgeBaseId || currentKnowledgeBaseId || undefined,
    kbSnapshotId:
      routeRuntimeSelector.kbSnapshotId ||
      (shouldReuseCurrentSnapshot ? currentKbSnapshotId : undefined) ||
      undefined,
    deployHash:
      routeRuntimeSelector.deployHash ||
      (shouldReuseCurrentSnapshot ? currentKbSnapshotDeployHash : undefined) ||
      undefined,
    runtimeScopeId: routeRuntimeSelector.runtimeScopeId || undefined,
  };
};

export const buildRuntimeScopeKeyFromRouteQuery = (
  routerQuery: RouterQueryLike,
) =>
  [
    routerQuery.workspaceId,
    routerQuery.knowledgeBaseId,
    routerQuery.kbSnapshotId,
    routerQuery.deployHash,
    routerQuery.runtimeScopeId,
  ]
    .map((value) => (Array.isArray(value) ? value[0] : value) || '')
    .join('|');

export const resolveKnowledgeRuntimeSyncScopeKey = ({
  routerReady,
  hasRuntimeScope,
  currentRouteRuntimeScopeKey,
}: {
  routerReady: boolean;
  hasRuntimeScope: boolean;
  currentRouteRuntimeScopeKey: string;
}) => {
  if (!routerReady || !hasRuntimeScope) {
    return null;
  }

  return currentRouteRuntimeScopeKey;
};

export default function useKnowledgeRuntimeContext({
  routerQuery,
  routerReady,
  hasRuntimeScope,
  runtimeSelectorState,
}: {
  routerQuery: RouterQueryLike;
  routerReady: boolean;
  hasRuntimeScope: boolean;
  runtimeSelectorState: RuntimeSelectorState | null;
}) {
  const routeRuntimeSelector = useMemo(
    () =>
      readRuntimeScopeSelectorFromObject(
        routerQuery as Record<string, string | string[] | undefined>,
      ),
    [routerQuery],
  );
  const effectiveRuntimeSelector = useMemo(
    () =>
      resolveKnowledgeEffectiveRuntimeSelector({
        routeRuntimeSelector,
        currentWorkspaceId: runtimeSelectorState?.currentWorkspace?.id,
        currentKnowledgeBaseId: runtimeSelectorState?.currentKnowledgeBase?.id,
        currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
        currentKbSnapshotDeployHash:
          runtimeSelectorState?.currentKbSnapshot?.deployHash,
      }),
    [
      routeRuntimeSelector,
      runtimeSelectorState?.currentKbSnapshot?.deployHash,
      runtimeSelectorState?.currentKbSnapshot?.id,
      runtimeSelectorState?.currentKnowledgeBase?.id,
      runtimeSelectorState?.currentWorkspace?.id,
    ],
  );
  const currentKnowledgeBaseId = runtimeSelectorState?.currentKnowledgeBase?.id;
  const currentKbSnapshotId = runtimeSelectorState?.currentKbSnapshot?.id;
  const routeKnowledgeBaseId = effectiveRuntimeSelector.knowledgeBaseId;
  const routeKbSnapshotId = effectiveRuntimeSelector.kbSnapshotId;
  const currentRouteRuntimeScopeKey = useMemo(
    () => buildRuntimeScopeKeyFromRouteQuery(routerQuery),
    [
      routerQuery.deployHash,
      routerQuery.kbSnapshotId,
      routerQuery.knowledgeBaseId,
      routerQuery.runtimeScopeId,
      routerQuery.workspaceId,
    ],
  );
  const runtimeSyncScopeKey = useMemo(
    () =>
      resolveKnowledgeRuntimeSyncScopeKey({
        routerReady,
        hasRuntimeScope,
        currentRouteRuntimeScopeKey,
      }),
    [currentRouteRuntimeScopeKey, hasRuntimeScope, routerReady],
  );

  return {
    routeRuntimeSelector,
    effectiveRuntimeSelector,
    currentKnowledgeBaseId,
    currentKbSnapshotId,
    routeKnowledgeBaseId,
    routeKbSnapshotId,
    currentRouteRuntimeScopeKey,
    runtimeSyncScopeKey,
  };
}
