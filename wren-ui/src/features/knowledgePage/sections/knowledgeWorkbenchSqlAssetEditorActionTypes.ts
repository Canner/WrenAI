import type { SqlPair } from '@/types/knowledge';
import type { AssetView } from '@/features/knowledgePage/types';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

export type SqlDraftValues = Partial<{
  sql: string;
  description: string;
}>;

export type KnowledgeWorkbenchSqlActionsArgs = {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  editingSqlPair?: SqlPair | null;
  isRuleDraftDirty: boolean;
  isSqlDraftDirty: boolean;
  onChangeWorkbenchSection: (
    nextSection: KnowledgeWorkbenchSectionKey,
  ) => void | Promise<void>;
  onCreateSqlTemplateDraftFromAsset?: (asset: AssetView) => void;
  onDeleteSqlTemplate: (sqlPair: SqlPair) => Promise<void> | void;
  onOpenSqlTemplateDetail: (sqlPair?: SqlPair) => void;
  onResetSqlTemplateEditor: () => void;
  onSubmitSqlTemplateDetail: () => Promise<void> | void;
  sqlTemplateForm: { setFieldsValue: (values: Record<string, any>) => void };
  sqlTemplateDrawerOpen: boolean;
  syncSqlDraftBaseline: (values?: Record<string, any>) => void;
  setSqlContextAssetId: (value?: string) => void;
  setSqlTemplateDrawerOpen: (open: boolean) => void;
  sqlContextAsset?: AssetView | null;
  runWithDirtyGuard: (
    dirty: boolean,
    action: () => void | Promise<void>,
  ) => Promise<boolean>;
  confirmDeleteEntry: (entityLabel: string) => Promise<boolean>;
};

export type KnowledgeWorkbenchSqlActionCore = {
  applyContextDraft: () => void;
  handleCloseDrawer: () => Promise<boolean>;
  handleCreateFromAsset: (asset: AssetView) => Promise<void>;
  handleDeleteItem: (sqlPair: SqlPair) => Promise<void>;
  handleDuplicateItem: (sqlPair: SqlPair) => Promise<void>;
  handleResetEditor: () => void;
  handleSubmitDetail: () => Promise<void>;
};

export type KnowledgeWorkbenchSqlOpenEditorParams = {
  sqlPair?: SqlPair;
  draftValues?: SqlDraftValues;
  contextAssetId?: string;
  switchSection?: boolean;
};
