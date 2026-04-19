import type {
  KnowledgeWorkbenchEditorsActions,
  KnowledgeWorkbenchEditorsDraftState,
} from './knowledgeWorkbenchEditorsTypes';

export function buildKnowledgeWorkbenchEditorsResult({
  draftState,
  editorActions,
}: {
  draftState: KnowledgeWorkbenchEditorsDraftState;
  editorActions: KnowledgeWorkbenchEditorsActions;
}) {
  return {
    ...editorActions,
    ruleContextAsset: draftState.ruleContextAsset,
    ruleContextAssetId: draftState.ruleContextAssetId,
    ruleDrawerOpen: draftState.ruleDrawerOpen,
    ruleListScope: draftState.ruleListScope,
    ruleSearchKeyword: draftState.ruleSearchKeyword,
    setRuleContextAssetId: draftState.setRuleContextAssetId,
    setRuleListScope: draftState.setRuleListScope,
    setRuleSearchKeyword: draftState.setRuleSearchKeyword,
    setSqlContextAssetId: draftState.setSqlContextAssetId,
    setSqlListMode: draftState.setSqlListMode,
    setSqlSearchKeyword: draftState.setSqlSearchKeyword,
    sqlContextAsset: draftState.sqlContextAsset,
    sqlContextAssetId: draftState.sqlContextAssetId,
    sqlListMode: draftState.sqlListMode,
    sqlSearchKeyword: draftState.sqlSearchKeyword,
    sqlTemplateAssetOptions: draftState.sqlTemplateAssetOptions,
    sqlTemplateDrawerOpen: draftState.sqlTemplateDrawerOpen,
    visibleRuleList: draftState.visibleRuleList,
    visibleSqlList: draftState.visibleSqlList,
  };
}
