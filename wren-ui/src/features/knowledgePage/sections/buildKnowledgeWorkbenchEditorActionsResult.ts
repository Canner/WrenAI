import type { KnowledgeWorkbenchEditorsActions } from './knowledgeWorkbenchEditorsTypes';
import type {
  KnowledgeWorkbenchRuleEditorLaneActions,
  KnowledgeWorkbenchSqlEditorLaneActions,
} from './knowledgeWorkbenchEditorActionsTypes';

export function buildKnowledgeWorkbenchEditorActionsResult({
  handleWorkbenchSectionChange,
  ruleActions,
  sqlActions,
}: {
  handleWorkbenchSectionChange: KnowledgeWorkbenchEditorsActions['handleWorkbenchSectionChange'];
  ruleActions: KnowledgeWorkbenchRuleEditorLaneActions;
  sqlActions: KnowledgeWorkbenchSqlEditorLaneActions;
}): KnowledgeWorkbenchEditorsActions {
  return {
    handleWorkbenchSectionChange,
    ...ruleActions,
    ...sqlActions,
  };
}
