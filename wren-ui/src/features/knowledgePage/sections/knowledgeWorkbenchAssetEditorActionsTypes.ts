import type { AssetView } from '@/features/knowledgePage/types';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

export type KnowledgeWorkbenchEditorRailSection = Extract<
  KnowledgeWorkbenchSectionKey,
  'instructions' | 'sqlTemplates'
>;

export type KnowledgeWorkbenchAssetEditorFormController = {
  setFieldsValue: (values: Record<string, any>) => void;
};

export type KnowledgeWorkbenchAssetEditorActionsArgs<
  TItem,
  TDraftValues extends Record<string, any>,
> = {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  applySuccessMessage: string;
  buildDraftFromAsset: (asset: AssetView) => TDraftValues;
  buildDuplicateDraft: (item: TItem) => TDraftValues;
  buildEditorValues: (params: {
    item?: TItem;
    draftValues?: TDraftValues;
  }) => Record<string, any>;
  confirmDeleteEntry: (entityLabel: string) => Promise<boolean>;
  contextAsset?: AssetView | null;
  contextAssetId?: string;
  createFromAssetSuccessMessage: string;
  currentEditingId?: string | number | null;
  currentSectionDirty: boolean;
  counterpartSectionDirty: boolean;
  drawerOpen: boolean;
  duplicateSuccessMessage: string;
  editingItemId?: string | number | null;
  emptyValues: Record<string, any>;
  entityLabel: string;
  form: KnowledgeWorkbenchAssetEditorFormController;
  getItemId: (item: TItem) => string | number | null | undefined;
  onChangeWorkbenchSection: (
    nextSection: KnowledgeWorkbenchEditorRailSection,
  ) => void | Promise<void>;
  onCreateDraftFromAsset?: (asset: AssetView) => void;
  onDeleteItem: (item: TItem) => Promise<void> | void;
  onOpenDetail: (item?: TItem) => void;
  onResetEditor: () => void;
  onSubmitDetail: () => Promise<void> | void;
  runWithDirtyGuard: (
    dirty: boolean,
    action: () => void | Promise<void>,
  ) => Promise<boolean>;
  setContextAssetId: (value?: string) => void;
  setDrawerOpen: (open: boolean) => void;
  syncDraftBaseline: (values?: Record<string, any>) => void;
  targetSection: KnowledgeWorkbenchEditorRailSection;
};

export type KnowledgeWorkbenchAssetEditorActionsResult<
  TItem,
  TDraftValues extends Record<string, any>,
> = {
  applyContextDraft: () => void;
  contextAssetId?: string;
  handleCloseDrawer: () => Promise<boolean>;
  handleCreateFromAsset: (asset: AssetView) => Promise<void>;
  handleDeleteItem: (item: TItem) => Promise<void>;
  handleDuplicateItem: (item: TItem) => Promise<void>;
  handleResetEditor: () => void;
  handleSubmitDetail: () => Promise<void>;
  openEditor: (params: {
    item?: TItem;
    draftValues?: TDraftValues;
    contextAssetId?: string;
    switchSection?: boolean;
  }) => Promise<boolean>;
};
