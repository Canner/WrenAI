import type { KnowledgeMainStageProps } from './knowledgeMainStageTypes';
import type { KnowledgeInstructionsStageProps } from './KnowledgeInstructionsStage';
import type { KnowledgeSqlTemplatesStageProps } from './KnowledgeSqlTemplatesStage';
import type { useKnowledgeWorkbenchEditors } from './useKnowledgeWorkbenchEditors';

export type KnowledgeWorkbenchEditorsState = ReturnType<
  typeof useKnowledgeWorkbenchEditors
>;

export type KnowledgeSqlStageArgs = Pick<
  KnowledgeMainStageProps,
  | 'createSqlPairLoading'
  | 'editingSqlPair'
  | 'isKnowledgeMutationDisabled'
  | 'sqlList'
  | 'sqlManageLoading'
  | 'sqlTemplateForm'
  | 'updateSqlPairLoading'
> & {
  editors: Pick<
    KnowledgeWorkbenchEditorsState,
    | 'applySqlContextDraft'
    | 'handleCloseSqlTemplateDrawer'
    | 'handleCreateRuleFromAsset'
    | 'handleDeleteSqlTemplate'
    | 'handleDuplicateSqlTemplate'
    | 'handleResetSqlTemplateEditor'
    | 'handleSubmitSqlTemplateDetail'
    | 'openSqlTemplateEditor'
    | 'setSqlContextAssetId'
    | 'setSqlListMode'
    | 'setSqlSearchKeyword'
    | 'sqlContextAsset'
    | 'sqlContextAssetId'
    | 'sqlListMode'
    | 'sqlSearchKeyword'
    | 'sqlTemplateAssetOptions'
    | 'sqlTemplateDrawerOpen'
    | 'visibleSqlList'
  >;
};

export type KnowledgeInstructionStageArgs = Pick<
  KnowledgeMainStageProps,
  | 'createInstructionLoading'
  | 'editingInstruction'
  | 'isKnowledgeMutationDisabled'
  | 'ruleForm'
  | 'ruleList'
  | 'ruleManageLoading'
  | 'updateInstructionLoading'
> & {
  editors: Pick<
    KnowledgeWorkbenchEditorsState,
    | 'applyRuleContextDraft'
    | 'handleCloseRuleDrawer'
    | 'handleCreateSqlTemplateFromAsset'
    | 'handleDeleteRule'
    | 'handleDuplicateRule'
    | 'handleResetRuleDetailEditor'
    | 'handleSubmitRuleDetail'
    | 'openRuleEditor'
    | 'ruleContextAsset'
    | 'ruleContextAssetId'
    | 'ruleDrawerOpen'
    | 'ruleListScope'
    | 'ruleSearchKeyword'
    | 'setRuleContextAssetId'
    | 'setRuleListScope'
    | 'setRuleSearchKeyword'
    | 'sqlTemplateAssetOptions'
    | 'visibleRuleList'
  >;
};

export type {
  KnowledgeInstructionsStageProps,
  KnowledgeSqlTemplatesStageProps,
};
