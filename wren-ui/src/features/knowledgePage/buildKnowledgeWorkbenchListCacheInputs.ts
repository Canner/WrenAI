import useKnowledgeBaseListCache from '@/hooks/useKnowledgeBaseListCache';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type {
  KnowledgeWorkbenchKnowledgeStateArgs,
  KnowledgeWorkbenchRuntimeContextState,
} from './knowledgeWorkbenchKnowledgeStateTypes';

export function buildKnowledgeWorkbenchListCacheInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  {
    hasRuntimeScope,
  }: Pick<
    KnowledgeWorkbenchKnowledgeStateArgs<TKnowledgeBase, TConnector>,
    'hasRuntimeScope'
  >,
  {
    effectiveRuntimeSelector,
  }: Pick<KnowledgeWorkbenchRuntimeContextState, 'effectiveRuntimeSelector'>,
): Parameters<typeof useKnowledgeBaseListCache<TKnowledgeBase>>[0] {
  return {
    hasRuntimeScope,
    workspaceId: effectiveRuntimeSelector.workspaceId,
  };
}

export default buildKnowledgeWorkbenchListCacheInputs;
