import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  hasExplicitRuntimeScopeSelector,
  normalizeSelector,
} from '@/runtime/client/runtimeScope';
import type { ThreadResponse } from '@/types/home';

type ThreadResponseRuntimeIdentity = Pick<
  ThreadResponse,
  'workspaceId' | 'knowledgeBaseId' | 'kbSnapshotId' | 'deployHash'
>;

export const resolveThreadResponseRuntimeSelector = ({
  response,
  fallbackSelector = {},
}: {
  response?: ThreadResponseRuntimeIdentity | null;
  fallbackSelector?: ClientRuntimeScopeSelector;
}): ClientRuntimeScopeSelector => {
  const responseSelector = normalizeSelector({
    workspaceId: response?.workspaceId || undefined,
    knowledgeBaseId: response?.knowledgeBaseId || undefined,
    kbSnapshotId: response?.kbSnapshotId || undefined,
    deployHash: response?.deployHash || undefined,
  });

  if (hasExplicitRuntimeScopeSelector(responseSelector)) {
    return responseSelector;
  }

  return normalizeSelector(fallbackSelector);
};
