import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type {
  KnowledgeWorkbenchControllerInteractionInputs,
  KnowledgeWorkbenchPageInteractionLocalState,
} from './knowledgeWorkbenchPageInteractionInputTypes';

export function buildKnowledgeWorkbenchPageInteractionLocalInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  localState: KnowledgeWorkbenchPageInteractionLocalState,
): Pick<
  KnowledgeWorkbenchControllerInteractionInputs<TKnowledgeBase, TConnector>,
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
> {
  const {
    assetDraft,
    detailAsset,
    detailFieldFilter,
    detailFieldKeyword,
    kbForm,
    knowledgeTab,
    resetAssetDraft,
    resetDetailViewState,
    ruleForm,
    setAssetDraft,
    setAssetModalOpen,
    setAssetWizardStep,
    setDetailAsset,
    setDraftAssets,
    sqlTemplateForm,
  } = localState;

  return {
    assetDraft,
    detailAsset,
    detailFieldFilter,
    detailFieldKeyword,
    kbForm,
    knowledgeTab,
    resetAssetDraft,
    resetDetailViewState,
    ruleForm,
    setAssetDraft,
    setAssetModalOpen,
    setAssetWizardStep,
    setDetailAsset,
    setDraftAssets,
    sqlTemplateForm,
  };
}

export default buildKnowledgeWorkbenchPageInteractionLocalInputs;
