import useKnowledgePageLocalState from './useKnowledgePageLocalState';

export type KnowledgeWorkbenchPageInteractionLocalState = Pick<
  ReturnType<typeof useKnowledgePageLocalState>,
  | 'assetDraft'
  | 'detailAsset'
  | 'detailFieldFilter'
  | 'detailFieldKeyword'
  | 'kbForm'
  | 'knowledgeTab'
  | 'resetAssetDraft'
  | 'resetDetailViewState'
  | 'ruleForm'
  | 'setAssetDraft'
  | 'setAssetModalOpen'
  | 'setAssetWizardStep'
  | 'setDetailAsset'
  | 'setDraftAssets'
  | 'sqlTemplateForm'
>;
