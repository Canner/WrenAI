import type { AssetView } from '@/features/knowledgePage/types';
import type {
  KnowledgeWorkbenchEditorEntryActionsArgs,
  KnowledgeWorkbenchEditorOpenDraft,
} from './knowledgeWorkbenchEditorEntryActionTypes';

export async function runKnowledgeWorkbenchCreateDraftFromAsset<
  TItem,
  TDraftValues extends Record<string, any>,
>({
  asset,
  buildDraftFromAsset,
  createFromAssetSuccessMessage,
  onCreateDraftFromAsset,
  openEditor,
  showSuccess,
}: {
  asset: AssetView;
  buildDraftFromAsset: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['buildDraftFromAsset'];
  createFromAssetSuccessMessage: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['createFromAssetSuccessMessage'];
  onCreateDraftFromAsset?: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['onCreateDraftFromAsset'];
  openEditor: KnowledgeWorkbenchEditorOpenDraft<TItem, TDraftValues>;
  showSuccess: (message: string) => void;
}) {
  const draftValues = buildDraftFromAsset(asset);
  const opened = await openEditor({
    draftValues,
    contextAssetId: asset.id,
  });
  if (!opened) {
    return;
  }
  showSuccess(createFromAssetSuccessMessage);
  onCreateDraftFromAsset?.(asset);
}

export async function runKnowledgeWorkbenchDuplicateEntry<
  TItem,
  TDraftValues extends Record<string, any>,
>({
  item,
  buildDuplicateDraft,
  duplicateSuccessMessage,
  openEditor,
  showSuccess,
}: {
  item: TItem;
  buildDuplicateDraft: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['buildDuplicateDraft'];
  duplicateSuccessMessage: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['duplicateSuccessMessage'];
  openEditor: KnowledgeWorkbenchEditorOpenDraft<TItem, TDraftValues>;
  showSuccess: (message: string) => void;
}) {
  const opened = await openEditor({
    draftValues: buildDuplicateDraft(item),
  });
  if (!opened) {
    return;
  }
  showSuccess(duplicateSuccessMessage);
}

export async function runKnowledgeWorkbenchDeleteEntry<
  TItem,
  TDraftValues extends Record<string, any>,
>({
  item,
  clearActiveEditorDraft,
  confirmDeleteEntry,
  editingItemId,
  entityLabel,
  getItemId,
  onDeleteItem,
}: {
  item: TItem;
  clearActiveEditorDraft: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['clearActiveEditorDraft'];
  confirmDeleteEntry: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['confirmDeleteEntry'];
  editingItemId?: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['editingItemId'];
  entityLabel: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['entityLabel'];
  getItemId: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['getItemId'];
  onDeleteItem: KnowledgeWorkbenchEditorEntryActionsArgs<
    TItem,
    TDraftValues
  >['onDeleteItem'];
}) {
  const confirmed = await confirmDeleteEntry(entityLabel);
  if (!confirmed) {
    return;
  }
  const isDeletingActiveDraft = editingItemId === getItemId(item);
  await onDeleteItem(item);
  if (isDeletingActiveDraft) {
    clearActiveEditorDraft();
  }
}
