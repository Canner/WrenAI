import type { KnowledgeMainStageProps } from './knowledgeMainStageTypes';
import type { KnowledgeWorkbenchEditorsArgs } from './knowledgeWorkbenchEditorsTypes';

export function buildKnowledgeMainStageEditorsInput({
  activeWorkbenchSection,
  detailAssets,
  editingInstruction,
  editingSqlPair,
  onChangeWorkbenchSection,
  onCreateRuleDraftFromAsset,
  onCreateSqlTemplateDraftFromAsset,
  onDeleteRule,
  onDeleteSqlTemplate,
  onOpenRuleDetail,
  onOpenSqlTemplateDetail,
  onResetRuleDetailEditor,
  onResetSqlTemplateEditor,
  onSubmitRuleDetail,
  onSubmitSqlTemplateDetail,
  ruleForm,
  ruleList,
  sqlList,
  sqlTemplateForm,
}: Pick<
  KnowledgeMainStageProps,
  | 'activeWorkbenchSection'
  | 'detailAssets'
  | 'editingInstruction'
  | 'editingSqlPair'
  | 'onChangeWorkbenchSection'
  | 'onCreateRuleDraftFromAsset'
  | 'onCreateSqlTemplateDraftFromAsset'
  | 'onDeleteRule'
  | 'onDeleteSqlTemplate'
  | 'onOpenRuleDetail'
  | 'onOpenSqlTemplateDetail'
  | 'onResetRuleDetailEditor'
  | 'onResetSqlTemplateEditor'
  | 'onSubmitRuleDetail'
  | 'onSubmitSqlTemplateDetail'
  | 'ruleForm'
  | 'ruleList'
  | 'sqlList'
  | 'sqlTemplateForm'
>): KnowledgeWorkbenchEditorsArgs {
  return {
    activeWorkbenchSection,
    detailAssets,
    editingInstruction,
    editingSqlPair,
    onChangeWorkbenchSection,
    onCreateRuleDraftFromAsset,
    onCreateSqlTemplateDraftFromAsset,
    onDeleteRule,
    onDeleteSqlTemplate,
    onOpenRuleDetail,
    onOpenSqlTemplateDetail,
    onResetRuleDetailEditor,
    onResetSqlTemplateEditor,
    onSubmitRuleDetail,
    onSubmitSqlTemplateDetail,
    ruleForm,
    ruleList,
    sqlList,
    sqlTemplateForm,
  };
}
