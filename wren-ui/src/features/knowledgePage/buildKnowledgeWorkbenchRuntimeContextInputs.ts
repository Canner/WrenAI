import useKnowledgeRuntimeContext from '@/hooks/useKnowledgeRuntimeContext';
import type { RuntimeSelectorState } from '@/hooks/useRuntimeSelectorState';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchKnowledgeStateArgs } from './knowledgeWorkbenchKnowledgeStateTypes';

export function buildKnowledgeWorkbenchRuntimeContextInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  {
    hasRuntimeScope,
    routerQuery,
    routerReady,
  }: KnowledgeWorkbenchKnowledgeStateArgs<TKnowledgeBase, TConnector>,
  runtimeSelectorState: RuntimeSelectorState | null,
): Parameters<typeof useKnowledgeRuntimeContext>[0] {
  return {
    routerQuery,
    routerReady,
    hasRuntimeScope,
    runtimeSelectorState,
  };
}

export default buildKnowledgeWorkbenchRuntimeContextInputs;
