import { useCallback } from 'react';
import {
  buildKnowledgeWorkbenchRuleActionsResult,
  buildKnowledgeWorkbenchRuleAssetEditorActionsInput,
  buildKnowledgeWorkbenchRuleOpenEditorInput,
  type KnowledgeWorkbenchRuleActionsArgs,
  type RuleDraftValues,
} from './knowledgeWorkbenchAssetEditorActionConfigs';
import { useKnowledgeWorkbenchAssetEditorActions } from './useKnowledgeWorkbenchAssetEditorActions';
import { Instruction } from '@/types/knowledge';

export function useKnowledgeWorkbenchRuleActions(
  args: KnowledgeWorkbenchRuleActionsArgs,
) {
  const {
    applyContextDraft,
    handleCloseDrawer,
    handleCreateFromAsset,
    handleDeleteItem,
    handleDuplicateItem,
    handleResetEditor,
    handleSubmitDetail,
    openEditor,
  } = useKnowledgeWorkbenchAssetEditorActions<Instruction, RuleDraftValues>(
    buildKnowledgeWorkbenchRuleAssetEditorActionsInput(args),
  );

  const openRuleEditor = useCallback(
    (params: {
      instruction?: Instruction;
      draftValues?: RuleDraftValues;
      contextAssetId?: string;
      switchSection?: boolean;
    }) => openEditor(buildKnowledgeWorkbenchRuleOpenEditorInput(params)),
    [openEditor],
  );

  return buildKnowledgeWorkbenchRuleActionsResult({
    applyContextDraft,
    handleCloseDrawer,
    handleCreateFromAsset,
    handleDeleteItem,
    handleDuplicateItem,
    handleResetEditor,
    handleSubmitDetail,
    openRuleEditor,
  });
}
