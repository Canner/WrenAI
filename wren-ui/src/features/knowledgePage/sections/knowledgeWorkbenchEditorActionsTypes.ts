import type { Instruction, SqlPair } from '@/types/knowledge';
import type { AssetView } from '@/features/knowledgePage/types';
import type { KnowledgeWorkbenchAssetEditorFormController } from './knowledgeWorkbenchAssetEditorActionsTypes';
import type { KnowledgeWorkbenchEditorsActions } from './knowledgeWorkbenchEditorsTypes';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

export type KnowledgeWorkbenchEditorActionsArgs = {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  editingInstruction?: Instruction | null;
  editingSqlPair?: SqlPair | null;
  isRuleDraftDirty: boolean;
  isSqlDraftDirty: boolean;
  onChangeWorkbenchSection: (
    nextSection: KnowledgeWorkbenchSectionKey,
  ) => void | Promise<void>;
  onCreateRuleDraftFromAsset?: (asset: AssetView) => void;
  onCreateSqlTemplateDraftFromAsset?: (asset: AssetView) => void;
  onDeleteRule: (instruction: Instruction) => Promise<void> | void;
  onDeleteSqlTemplate: (sqlPair: SqlPair) => Promise<void> | void;
  onOpenRuleDetail: (instruction?: Instruction) => void;
  onOpenSqlTemplateDetail: (sqlPair?: SqlPair) => void;
  onResetRuleDetailEditor: () => void;
  onResetSqlTemplateEditor: () => void;
  onSubmitRuleDetail: () => Promise<void> | void;
  onSubmitSqlTemplateDetail: () => Promise<void> | void;
  ruleContextAsset?: AssetView | null;
  ruleDrawerOpen: boolean;
  ruleForm: KnowledgeWorkbenchAssetEditorFormController;
  setRuleContextAssetId: (value?: string) => void;
  setRuleDrawerOpen: (open: boolean) => void;
  setSqlContextAssetId: (value?: string) => void;
  setSqlTemplateDrawerOpen: (open: boolean) => void;
  sqlContextAsset?: AssetView | null;
  sqlTemplateDrawerOpen: boolean;
  sqlTemplateForm: KnowledgeWorkbenchAssetEditorFormController;
  syncRuleDraftBaseline: (values?: Record<string, any>) => void;
  syncSqlDraftBaseline: (values?: Record<string, any>) => void;
};

export type KnowledgeWorkbenchSectionChangeGuardArgs = Pick<
  KnowledgeWorkbenchEditorActionsArgs,
  | 'activeWorkbenchSection'
  | 'isRuleDraftDirty'
  | 'isSqlDraftDirty'
  | 'onChangeWorkbenchSection'
  | 'setRuleDrawerOpen'
  | 'setSqlTemplateDrawerOpen'
>;

export type KnowledgeWorkbenchDeleteConfirm = (
  entityLabel: string,
) => Promise<boolean>;

export type KnowledgeWorkbenchDirtyGuardRunner = (
  dirty: boolean,
  action: () => void | Promise<void>,
) => Promise<boolean>;

export type KnowledgeWorkbenchRuleEditorLaneActions = Pick<
  KnowledgeWorkbenchEditorsActions,
  | 'applyRuleContextDraft'
  | 'handleCloseRuleDrawer'
  | 'handleCreateRuleFromAsset'
  | 'handleDeleteRule'
  | 'handleDuplicateRule'
  | 'handleResetRuleDetailEditor'
  | 'handleSubmitRuleDetail'
  | 'openRuleEditor'
>;

export type KnowledgeWorkbenchSqlEditorLaneActions = Pick<
  KnowledgeWorkbenchEditorsActions,
  | 'applySqlContextDraft'
  | 'handleCloseSqlTemplateDrawer'
  | 'handleCreateSqlTemplateFromAsset'
  | 'handleDeleteSqlTemplate'
  | 'handleDuplicateSqlTemplate'
  | 'handleResetSqlTemplateEditor'
  | 'handleSubmitSqlTemplateDetail'
  | 'openSqlTemplateEditor'
>;
