import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import {
  HISTORICAL_SNAPSHOT_READONLY_HINT,
  isHistoricalSnapshotReadonly,
} from '@/utils/runtimeSnapshot';

export default function useModelingAssistantReadonly() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeSelectorState = useRuntimeSelectorState();
  const selectorHasRuntime = Boolean(
    runtimeScopeNavigation.selector.deployHash ||
    runtimeScopeNavigation.selector.kbSnapshotId ||
    runtimeScopeNavigation.selector.runtimeScopeId,
  );

  const isReadOnly = Boolean(
    runtimeSelectorState.runtimeSelectorState?.currentKnowledgeBase?.kind ===
      'system_sample' ||
    isHistoricalSnapshotReadonly({
      selectorHasRuntime,
      currentKbSnapshotId:
        runtimeSelectorState.runtimeSelectorState?.currentKbSnapshot?.id,
      defaultKbSnapshotId:
        runtimeSelectorState.runtimeSelectorState?.currentKnowledgeBase
          ?.defaultKbSnapshotId,
    }),
  );

  return {
    isReadOnly,
    readOnlyHint: HISTORICAL_SNAPSHOT_READONLY_HINT,
  };
}
