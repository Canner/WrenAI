import type { KnowledgeWorkbenchPageInteractionArgs } from './knowledgeWorkbenchPageInteractionInputTypes';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export function buildKnowledgeWorkbenchPageInteractionArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  buildRuntimeScopeUrl,
  controllerDataState,
  hasRuntimeScope,
  localState,
  pushRoute,
  replaceWorkspace,
  router,
  routerAsPath,
  routerQuery,
  runtimeNavigationSelector,
  snapshotReadonlyHint,
}: KnowledgeWorkbenchPageInteractionArgs<
  TKnowledgeBase,
  TConnector
>): KnowledgeWorkbenchPageInteractionArgs<TKnowledgeBase, TConnector> {
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
    buildRuntimeScopeUrl,
    controllerDataState,
    hasRuntimeScope,
    localState: {
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
    },
    pushRoute,
    replaceWorkspace,
    router,
    routerAsPath,
    routerQuery,
    runtimeNavigationSelector,
    snapshotReadonlyHint,
  };
}

export default buildKnowledgeWorkbenchPageInteractionArgs;
