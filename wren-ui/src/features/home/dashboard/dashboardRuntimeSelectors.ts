import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { normalizeSelector } from '@/runtime/client/runtimeScope';

type DashboardRuntimeBindingFields = {
  deployHash?: string | null;
  kbSnapshotId?: string | null;
  knowledgeBaseId?: string | null;
};

export const resolveDashboardBoundSelector = ({
  workspaceSelector,
  dashboard,
  fallbackSelector = {},
}: {
  workspaceSelector: ClientRuntimeScopeSelector;
  dashboard?: DashboardRuntimeBindingFields | null;
  fallbackSelector?: ClientRuntimeScopeSelector;
}): ClientRuntimeScopeSelector => {
  const workspaceId =
    workspaceSelector.workspaceId || fallbackSelector.workspaceId || undefined;
  const hasDashboardContext = dashboard != null;
  const knowledgeBaseId = hasDashboardContext
    ? dashboard?.knowledgeBaseId || undefined
    : fallbackSelector.knowledgeBaseId || undefined;
  const kbSnapshotId = hasDashboardContext
    ? dashboard?.kbSnapshotId || undefined
    : fallbackSelector.kbSnapshotId || undefined;
  const deployHash = hasDashboardContext
    ? dashboard?.deployHash || undefined
    : fallbackSelector.deployHash || undefined;

  return normalizeSelector({
    ...(workspaceId ? { workspaceId } : {}),
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(kbSnapshotId ? { kbSnapshotId } : {}),
    ...(deployHash ? { deployHash } : {}),
    ...(workspaceSelector.runtimeScopeId && !workspaceId
      ? { runtimeScopeId: workspaceSelector.runtimeScopeId }
      : {}),
  });
};
