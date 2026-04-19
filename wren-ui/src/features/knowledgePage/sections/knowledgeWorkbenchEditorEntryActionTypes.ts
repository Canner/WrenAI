import type { AssetView } from '@/features/knowledgePage/types';

export type KnowledgeWorkbenchEditorOpenDraft<
  TItem,
  TDraftValues extends Record<string, any>,
> = (params: {
  item?: TItem;
  draftValues?: TDraftValues;
  contextAssetId?: string;
  switchSection?: boolean;
}) => Promise<boolean>;

export type KnowledgeWorkbenchEditorEntryActionsArgs<
  TItem,
  TDraftValues extends Record<string, any>,
> = {
  buildDraftFromAsset: (asset: AssetView) => TDraftValues;
  buildDuplicateDraft: (item: TItem) => TDraftValues;
  clearActiveEditorDraft: () => void;
  confirmDeleteEntry: (entityLabel: string) => Promise<boolean>;
  createFromAssetSuccessMessage: string;
  duplicateSuccessMessage: string;
  editingItemId?: string | number | null;
  entityLabel: string;
  getItemId: (item: TItem) => string | number | null | undefined;
  onCreateDraftFromAsset?: (asset: AssetView) => void;
  onDeleteItem: (item: TItem) => Promise<void> | void;
  openEditor: KnowledgeWorkbenchEditorOpenDraft<TItem, TDraftValues>;
};
