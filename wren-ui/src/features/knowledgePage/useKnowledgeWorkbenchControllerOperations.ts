import { buildKnowledgeWorkbenchActionsInputs } from './buildKnowledgeWorkbenchControllerActionsInputs';
import { buildKnowledgeWorkbenchRuleSqlInputs } from './buildKnowledgeWorkbenchControllerRuleSqlInputs';
import type { KnowledgeWorkbenchControllerOperationsArgs } from './knowledgeWorkbenchControllerOperationsTypes';
import useKnowledgeWorkbenchActions from './useKnowledgeWorkbenchActions';
import useKnowledgeWorkbenchRuleSql from './useKnowledgeWorkbenchRuleSql';
import type { KnowledgeBaseRecord } from './types';

export function useKnowledgeWorkbenchControllerOperations<
  TKnowledgeBase extends KnowledgeBaseRecord,
>(args: KnowledgeWorkbenchControllerOperationsArgs<TKnowledgeBase>) {
  const actions = useKnowledgeWorkbenchActions<TKnowledgeBase>(
    buildKnowledgeWorkbenchActionsInputs(args),
  );

  const ruleSqlState = useKnowledgeWorkbenchRuleSql(
    buildKnowledgeWorkbenchRuleSqlInputs(args),
  );

  return {
    actions,
    ruleSqlState,
  };
}

export default useKnowledgeWorkbenchControllerOperations;
