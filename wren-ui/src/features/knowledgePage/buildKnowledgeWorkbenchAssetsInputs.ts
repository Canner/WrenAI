import useKnowledgeAssets from '@/hooks/useKnowledgeAssets';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type {
  KnowledgeWorkbenchContentDataArgs,
  KnowledgeWorkbenchContentDiagramState,
} from './knowledgeWorkbenchContentDataTypes';

export function buildKnowledgeWorkbenchAssetsInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  {
    activeKnowledgeBase,
    activeKnowledgeBaseExecutable,
    draftAssets,
    knowledgeOwner,
    matchedDemoKnowledge,
  }: KnowledgeWorkbenchContentDataArgs<TKnowledgeBase, TConnector>,
  { diagramData }: Pick<KnowledgeWorkbenchContentDiagramState, 'diagramData'>,
): Parameters<typeof useKnowledgeAssets>[0] {
  return {
    activeKnowledgeBaseName: activeKnowledgeBase?.name,
    hasActiveKnowledgeBase: Boolean(activeKnowledgeBase),
    activeKnowledgeBaseUsesRuntime: activeKnowledgeBaseExecutable,
    diagramData,
    draftAssets,
    knowledgeOwner,
    matchedDemoKnowledge,
  };
}

export default buildKnowledgeWorkbenchAssetsInputs;
