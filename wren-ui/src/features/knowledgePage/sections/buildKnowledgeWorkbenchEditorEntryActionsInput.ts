import type { KnowledgeWorkbenchAssetEditorActionsArgs } from './knowledgeWorkbenchAssetEditorActionsTypes';

export function buildKnowledgeWorkbenchEditorEntryActionsInput<
  TItem,
  TDraftValues extends Record<string, any>,
>({
  buildDraftFromAsset,
  buildDuplicateDraft,
  clearActiveEditorDraft,
  confirmDeleteEntry,
  createFromAssetSuccessMessage,
  duplicateSuccessMessage,
  editingItemId,
  entityLabel,
  getItemId,
  onCreateDraftFromAsset,
  onDeleteItem,
  openEditor,
}: Pick<
  KnowledgeWorkbenchAssetEditorActionsArgs<TItem, TDraftValues>,
  | 'buildDraftFromAsset'
  | 'buildDuplicateDraft'
  | 'confirmDeleteEntry'
  | 'createFromAssetSuccessMessage'
  | 'duplicateSuccessMessage'
  | 'editingItemId'
  | 'entityLabel'
  | 'getItemId'
  | 'onCreateDraftFromAsset'
  | 'onDeleteItem'
> & {
  clearActiveEditorDraft: () => void;
  openEditor: (params: {
    item?: TItem;
    draftValues?: TDraftValues;
    contextAssetId?: string;
    switchSection?: boolean;
  }) => Promise<boolean>;
}) {
  return {
    buildDraftFromAsset,
    buildDuplicateDraft,
    clearActiveEditorDraft,
    confirmDeleteEntry,
    createFromAssetSuccessMessage,
    duplicateSuccessMessage,
    editingItemId,
    entityLabel,
    getItemId,
    onCreateDraftFromAsset,
    onDeleteItem,
    openEditor,
  };
}
