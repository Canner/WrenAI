import useKnowledgeSelectorFallback from '@/hooks/useKnowledgeSelectorFallback';
import type { KnowledgeWorkbenchRuntimeContextState } from './knowledgeWorkbenchKnowledgeStateTypes';
import type { RuntimeSelectorState } from '@/hooks/useRuntimeSelectorState';

export function buildKnowledgeWorkbenchSelectorFallbackInputs(
  {
    currentKbSnapshotId,
    effectiveRuntimeSelector,
    routeKbSnapshotId,
    routeKnowledgeBaseId,
  }: Pick<
    KnowledgeWorkbenchRuntimeContextState,
    | 'currentKbSnapshotId'
    | 'effectiveRuntimeSelector'
    | 'routeKbSnapshotId'
    | 'routeKnowledgeBaseId'
  >,
  {
    currentWorkspaceId,
    runtimeSelectorState,
  }: {
    currentWorkspaceId?: string;
    runtimeSelectorState: RuntimeSelectorState | null;
  },
): Parameters<typeof useKnowledgeSelectorFallback>[0] {
  return {
    runtimeSelectorState,
    routeKnowledgeBaseId,
    effectiveWorkspaceId: effectiveRuntimeSelector.workspaceId,
    currentWorkspaceId,
    routeKbSnapshotId,
    currentKbSnapshotId,
  };
}

export default buildKnowledgeWorkbenchSelectorFallbackInputs;
