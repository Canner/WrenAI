import { useKnowledgeWorkbenchDraftBaselineState } from './useKnowledgeWorkbenchDraftBaselineState';
import { useKnowledgeWorkbenchContextAssetState } from './useKnowledgeWorkbenchContextAssetState';
import { useKnowledgeWorkbenchDraftDerivedState } from './useKnowledgeWorkbenchDraftDerivedState';
import { useKnowledgeWorkbenchDraftUiState } from './useKnowledgeWorkbenchDraftUiState';
import { useKnowledgeWorkbenchDraftWatchValues } from './useKnowledgeWorkbenchDraftWatchValues';
import {
  buildKnowledgeWorkbenchDraftDerivedStateInput,
  buildKnowledgeWorkbenchDraftStateResult,
  type KnowledgeWorkbenchDraftStateArgs,
} from './knowledgeWorkbenchDraftStateHelpers';

export function useKnowledgeWorkbenchDraftState({
  detailAssets,
  ruleForm,
  ruleList,
  sqlList,
  sqlTemplateForm,
}: KnowledgeWorkbenchDraftStateArgs) {
  const uiState = useKnowledgeWorkbenchDraftUiState();
  const watchValues = useKnowledgeWorkbenchDraftWatchValues({
    ruleForm,
    sqlTemplateForm,
  });

  const baselineState = useKnowledgeWorkbenchDraftBaselineState({
    ruleForm,
    sqlTemplateForm,
  });

  const contextAssetState = useKnowledgeWorkbenchContextAssetState({
    detailAssets,
  });

  const derivedState = useKnowledgeWorkbenchDraftDerivedState(
    buildKnowledgeWorkbenchDraftDerivedStateInput({
      args: {
        detailAssets,
        ruleForm,
        ruleList,
        sqlList,
        sqlTemplateForm,
      },
      baselineState,
      uiState,
      watchValues,
    }),
  );

  return buildKnowledgeWorkbenchDraftStateResult({
    baselineState,
    contextAssetState,
    derivedState,
    uiState,
  });
}
