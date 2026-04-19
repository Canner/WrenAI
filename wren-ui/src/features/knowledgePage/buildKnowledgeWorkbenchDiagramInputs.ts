import useKnowledgeDiagramData from '@/hooks/useKnowledgeDiagramData';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchContentDataArgs } from './knowledgeWorkbenchContentDataTypes';

export function buildKnowledgeWorkbenchDiagramInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  activeKnowledgeBase,
  activeKnowledgeRuntimeSelector,
  activeKnowledgeSnapshotId,
  hasRuntimeScope,
}: KnowledgeWorkbenchContentDataArgs<TKnowledgeBase, TConnector>): Parameters<
  typeof useKnowledgeDiagramData
>[0] {
  return {
    hasRuntimeScope,
    routeKnowledgeBaseId: activeKnowledgeBase?.id || undefined,
    routeKbSnapshotId: activeKnowledgeSnapshotId || undefined,
    effectiveRuntimeSelector: activeKnowledgeRuntimeSelector || {},
  };
}

export default buildKnowledgeWorkbenchDiagramInputs;
