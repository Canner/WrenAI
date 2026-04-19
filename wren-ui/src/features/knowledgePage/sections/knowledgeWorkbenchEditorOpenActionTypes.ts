import type { KnowledgeWorkbenchAssetEditorFormController } from './knowledgeWorkbenchAssetEditorActionsTypes';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

export type KnowledgeWorkbenchEditorOpenTargetSection = Extract<
  KnowledgeWorkbenchSectionKey,
  'instructions' | 'sqlTemplates'
>;

export type KnowledgeWorkbenchEditorOpenActionArgs<
  TItem,
  TDraftValues extends Record<string, any>,
> = {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  targetSection: KnowledgeWorkbenchEditorOpenTargetSection;
  currentEditingId?: string | number | null;
  drawerOpen: boolean;
  currentSectionDirty: boolean;
  counterpartSectionDirty: boolean;
  onChangeWorkbenchSection: (
    nextSection: KnowledgeWorkbenchEditorOpenTargetSection,
  ) => void | Promise<void>;
  onOpenDetail: (item?: TItem) => void;
  form: KnowledgeWorkbenchAssetEditorFormController;
  syncDraftBaseline: (values?: Record<string, any>) => void;
  setContextAssetId: (value?: string) => void;
  setDrawerOpen: (open: boolean) => void;
  buildEditorValues: (params: {
    item?: TItem;
    draftValues?: TDraftValues;
  }) => Record<string, any>;
  runWithDirtyGuard: (
    dirty: boolean,
    action: () => void | Promise<void>,
  ) => Promise<boolean>;
};

export type KnowledgeWorkbenchEditorOpenActionParams<
  TItem,
  TDraftValues extends Record<string, any>,
> = {
  item?: TItem;
  draftValues?: TDraftValues;
  contextAssetId?: string;
  switchSection?: boolean;
};
