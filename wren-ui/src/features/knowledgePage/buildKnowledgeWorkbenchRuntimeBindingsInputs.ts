import useKnowledgeRuntimeBindings from './useKnowledgeRuntimeBindings';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type {
  KnowledgeWorkbenchBaseMetaState,
  KnowledgeWorkbenchKnowledgeStateArgs,
} from './knowledgeWorkbenchKnowledgeStateTypes';

export function buildKnowledgeWorkbenchRuntimeBindingsInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  {
    runtimeNavigationWorkspaceId,
  }: Pick<
    KnowledgeWorkbenchKnowledgeStateArgs<TKnowledgeBase, TConnector>,
    'runtimeNavigationWorkspaceId'
  >,
  {
    activeKnowledgeBase,
    effectiveWorkspaceId,
    runtimeSelectorState,
  }: {
    activeKnowledgeBase: KnowledgeWorkbenchBaseMetaState<TKnowledgeBase>['activeKnowledgeBase'];
    effectiveWorkspaceId?: string | null;
    runtimeSelectorState: Parameters<
      typeof useKnowledgeRuntimeBindings
    >[0]['runtimeSelectorState'];
  },
): Parameters<typeof useKnowledgeRuntimeBindings>[0] {
  return {
    activeKnowledgeBase,
    effectiveWorkspaceId,
    runtimeSelectorState,
    runtimeNavigationWorkspaceId,
  };
}

export default buildKnowledgeWorkbenchRuntimeBindingsInputs;
