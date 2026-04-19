import useKnowledgeDataLoaders from '@/hooks/useKnowledgeDataLoaders';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchKnowledgeStateArgs } from './knowledgeWorkbenchKnowledgeStateTypes';

export function buildKnowledgeWorkbenchDataLoadersInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  buildRuntimeScopeUrl,
}: Pick<
  KnowledgeWorkbenchKnowledgeStateArgs<TKnowledgeBase, TConnector>,
  'buildRuntimeScopeUrl'
>): Parameters<typeof useKnowledgeDataLoaders<TKnowledgeBase, TConnector>>[0] {
  return {
    buildRuntimeScopeUrl,
  };
}

export default buildKnowledgeWorkbenchDataLoadersInputs;
