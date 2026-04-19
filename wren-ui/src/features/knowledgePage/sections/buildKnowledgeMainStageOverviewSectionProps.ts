import type {
  KnowledgeHeaderSectionArgs,
  KnowledgeModelingSectionArgs,
  KnowledgeModelingSectionProps,
  KnowledgeOverviewSectionArgs,
  KnowledgeOverviewStageProps,
  KnowledgeWorkbenchHeaderProps,
} from './knowledgeMainStageOverviewSectionPropTypes';

export function buildKnowledgeWorkbenchHeaderProps({
  activeWorkbenchSection,
  previewFieldCount,
  isSnapshotReadonlyKnowledgeBase,
  isReadonlyKnowledgeBase,
  isKnowledgeMutationDisabled,
  knowledgeMutationHint,
  knowledgeDescription,
  onOpenKnowledgeEditor,
  onChangeWorkbenchSection,
}: KnowledgeHeaderSectionArgs): KnowledgeWorkbenchHeaderProps {
  return {
    activeWorkbenchSection,
    previewFieldCount,
    isSnapshotReadonlyKnowledgeBase,
    isReadonlyKnowledgeBase,
    isKnowledgeMutationDisabled,
    knowledgeMutationHint,
    knowledgeDescription,
    onOpenKnowledgeEditor,
    onChangeWorkbenchSection,
  };
}

export function buildKnowledgeOverviewStageProps({
  activeWorkbenchSection,
  activeDetailAsset,
  detailAssetFields,
  detailAssets,
  detailFieldFilter,
  detailFieldKeyword,
  detailTab,
  historicalSnapshotReadonlyHint,
  isKnowledgeMutationDisabled,
  isReadonlyKnowledgeBase,
  isSnapshotReadonlyKnowledgeBase,
  modelingSummary,
  onChangeDetailTab,
  onChangeFieldFilter,
  onChangeFieldKeyword,
  onCloseAssetDetail,
  onCreateRuleDraft,
  onCreateSqlTemplateDraft,
  onOpenAssetDetail,
  onOpenAssetWizard,
  onOpenModeling,
  previewFieldCount,
  ruleList,
  showKnowledgeAssetsLoading,
  sqlList,
}: KnowledgeOverviewSectionArgs): KnowledgeOverviewStageProps {
  return {
    activeWorkbenchSection,
    activeDetailAsset,
    detailAssetFields,
    detailAssets,
    detailFieldFilter,
    detailFieldKeyword,
    detailTab,
    historicalSnapshotReadonlyHint,
    isKnowledgeMutationDisabled,
    isReadonlyKnowledgeBase,
    isSnapshotReadonlyKnowledgeBase,
    modelingSummary,
    onChangeDetailTab,
    onChangeFieldFilter,
    onChangeFieldKeyword,
    onCloseAssetDetail,
    onCreateRuleDraft,
    onCreateSqlTemplateDraft,
    onOpenAssetDetail,
    onOpenAssetWizard,
    onOpenModeling,
    previewFieldCount,
    ruleListCount: ruleList.length,
    showKnowledgeAssetsLoading,
    sqlListCount: sqlList.length,
  };
}

export function buildKnowledgeModelingSectionProps({
  modelingSummary,
  modelingWorkspaceKey,
  workbenchModeLabel,
}: KnowledgeModelingSectionArgs): KnowledgeModelingSectionProps {
  return {
    modelingSummary,
    modelingWorkspaceKey,
    workbenchModeLabel,
  };
}
