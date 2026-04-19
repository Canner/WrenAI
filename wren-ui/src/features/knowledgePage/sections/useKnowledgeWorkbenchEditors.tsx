import { buildKnowledgeWorkbenchEditorActionsInput } from './buildKnowledgeWorkbenchEditorActionsInput';
import type { KnowledgeWorkbenchEditorsArgs } from './knowledgeWorkbenchEditorsTypes';
import { buildKnowledgeWorkbenchEditorsResult } from './buildKnowledgeWorkbenchEditorsResult';
import { buildKnowledgeWorkbenchDraftStateInput } from './buildKnowledgeWorkbenchDraftStateInput';
import { useKnowledgeWorkbenchDraftState } from './useKnowledgeWorkbenchDraftState';
import { useKnowledgeWorkbenchEditorActions } from './useKnowledgeWorkbenchEditorActions';

export function useKnowledgeWorkbenchEditors(
  args: KnowledgeWorkbenchEditorsArgs,
) {
  const draftState = useKnowledgeWorkbenchDraftState(
    buildKnowledgeWorkbenchDraftStateInput(args),
  );

  const editorActions = useKnowledgeWorkbenchEditorActions(
    buildKnowledgeWorkbenchEditorActionsInput({
      args,
      draftState,
    }),
  );

  return buildKnowledgeWorkbenchEditorsResult({
    draftState,
    editorActions,
  });
}
