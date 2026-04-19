import type { KnowledgeWorkbenchEditorsArgs } from './knowledgeWorkbenchEditorsTypes';

export function buildKnowledgeWorkbenchDraftStateInput({
  detailAssets,
  ruleForm,
  ruleList,
  sqlList,
  sqlTemplateForm,
}: KnowledgeWorkbenchEditorsArgs) {
  return {
    detailAssets,
    ruleForm,
    ruleList,
    sqlList,
    sqlTemplateForm,
  };
}
