import useKnowledgeRuntimeDataSync from '@/hooks/useKnowledgeRuntimeDataSync';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type {
  KnowledgeWorkbenchContentDataArgs,
  KnowledgeWorkbenchContentDiagramState,
} from './knowledgeWorkbenchContentDataTypes';

export function buildKnowledgeWorkbenchRuntimeDataSyncInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  {
    refetchRuntimeSelector,
    runtimeSyncScopeKey,
  }: KnowledgeWorkbenchContentDataArgs<TKnowledgeBase, TConnector>,
  {
    refetchDiagram,
  }: Pick<KnowledgeWorkbenchContentDiagramState, 'refetchDiagram'>,
): Parameters<typeof useKnowledgeRuntimeDataSync>[0] {
  return {
    runtimeSyncScopeKey,
    refetchRuntimeSelector,
    refetchDiagram,
  };
}

export default buildKnowledgeWorkbenchRuntimeDataSyncInputs;
