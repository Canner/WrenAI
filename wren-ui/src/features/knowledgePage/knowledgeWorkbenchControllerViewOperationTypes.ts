import useKnowledgeWorkbenchControllerOperations from './useKnowledgeWorkbenchControllerOperations';
import type { KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchControllerViewOperationState<
  TKnowledgeBase extends KnowledgeBaseRecord,
> = {
  actions: ReturnType<
    typeof useKnowledgeWorkbenchControllerOperations<TKnowledgeBase>
  >['actions'];
  ruleSqlState: ReturnType<
    typeof useKnowledgeWorkbenchControllerOperations<TKnowledgeBase>
  >['ruleSqlState'];
};
