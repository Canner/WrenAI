import type { KnowledgeWorkbenchMainStageProps } from './buildKnowledgeWorkbenchStageProps';
import type { KnowledgeWorkbenchControllerStageArgs } from './knowledgeWorkbenchControllerStageTypes';

export default function buildKnowledgeWorkbenchMainStageEditorInput({
  localState,
  modelingState,
  ruleSqlState,
  viewState,
}: Pick<
  KnowledgeWorkbenchControllerStageArgs,
  'localState' | 'modelingState' | 'ruleSqlState' | 'viewState'
>): Pick<
  KnowledgeWorkbenchMainStageProps,
  | 'ruleList'
  | 'sqlList'
  | 'ruleManageLoading'
  | 'sqlManageLoading'
  | 'onOpenRuleDetail'
  | 'onOpenSqlTemplateDetail'
  | 'onDeleteRule'
  | 'onDeleteSqlTemplate'
  | 'editingInstruction'
  | 'editingSqlPair'
  | 'ruleForm'
  | 'sqlTemplateForm'
  | 'createInstructionLoading'
  | 'updateInstructionLoading'
  | 'createSqlPairLoading'
  | 'updateSqlPairLoading'
  | 'onSubmitRuleDetail'
  | 'onSubmitSqlTemplateDetail'
  | 'onResetRuleDetailEditor'
  | 'onResetSqlTemplateEditor'
  | 'modelingWorkspaceKey'
  | 'modelingSummary'
  | 'onOpenModeling'
> {
  return {
    ruleList: ruleSqlState.ruleList,
    sqlList: ruleSqlState.sqlList,
    ruleManageLoading: ruleSqlState.ruleManageLoading,
    sqlManageLoading: ruleSqlState.sqlManageLoading,
    onOpenRuleDetail: ruleSqlState.openRuleDetail,
    onOpenSqlTemplateDetail: ruleSqlState.openSqlTemplateDetail,
    onDeleteRule: ruleSqlState.handleDeleteRule,
    onDeleteSqlTemplate: ruleSqlState.handleDeleteSqlTemplate,
    editingInstruction: ruleSqlState.editingInstruction,
    editingSqlPair: ruleSqlState.editingSqlPair,
    ruleForm: localState.ruleForm,
    sqlTemplateForm: localState.sqlTemplateForm,
    createInstructionLoading: ruleSqlState.createInstructionLoading,
    updateInstructionLoading: ruleSqlState.updateInstructionLoading,
    createSqlPairLoading: ruleSqlState.createSqlPairLoading,
    updateSqlPairLoading: ruleSqlState.updateSqlPairLoading,
    onSubmitRuleDetail: ruleSqlState.submitRuleDetail,
    onSubmitSqlTemplateDetail: ruleSqlState.submitSqlTemplateDetail,
    onResetRuleDetailEditor: ruleSqlState.resetRuleDetailEditor,
    onResetSqlTemplateEditor: ruleSqlState.resetSqlTemplateEditor,
    modelingWorkspaceKey: modelingState.committedModelingWorkspaceKey,
    modelingSummary: modelingState.modelingSummary,
    onOpenModeling: viewState.handleNavigateModeling,
  };
}
