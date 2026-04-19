import { Instruction, SqlPair } from '@/types/knowledge';
import type { AssetView } from '@/features/knowledgePage/types';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

export type KnowledgeWorkbenchEditorsArgs = {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  detailAssets: AssetView[];
  editingInstruction?: Instruction | null;
  editingSqlPair?: SqlPair | null;
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
  ruleForm: any;
  ruleList: Instruction[];
  sqlList: SqlPair[];
  sqlTemplateForm: any;
};

export type KnowledgeWorkbenchEditorsDraftState = {
  isRuleDraftDirty: boolean;
  isSqlDraftDirty: boolean;
  ruleContextAsset?: AssetView | null;
  ruleContextAssetId?: string;
  ruleDrawerOpen: boolean;
  ruleListScope: 'all' | 'default' | 'matched';
  ruleSearchKeyword: string;
  setRuleContextAssetId: (value?: string) => void;
  setRuleDrawerOpen: (open: boolean) => void;
  setRuleListScope: (value: 'all' | 'default' | 'matched') => void;
  setRuleSearchKeyword: (value: string) => void;
  setSqlContextAssetId: (value?: string) => void;
  setSqlListMode: (value: 'all' | 'recent') => void;
  setSqlSearchKeyword: (value: string) => void;
  setSqlTemplateDrawerOpen: (open: boolean) => void;
  sqlContextAsset?: AssetView | null;
  sqlContextAssetId?: string;
  sqlListMode: 'all' | 'recent';
  sqlSearchKeyword: string;
  sqlTemplateAssetOptions: Array<{ label: string; value: string }>;
  sqlTemplateDrawerOpen: boolean;
  syncRuleDraftBaseline: (values?: Record<string, any>) => void;
  syncSqlDraftBaseline: (values?: Record<string, any>) => void;
  visibleRuleList: Instruction[];
  visibleSqlList: SqlPair[];
};

export type KnowledgeWorkbenchEditorsActions = {
  applyRuleContextDraft: () => void;
  applySqlContextDraft: () => void;
  handleCloseRuleDrawer: () => Promise<boolean>;
  handleCloseSqlTemplateDrawer: () => Promise<boolean>;
  handleCreateRuleFromAsset: (asset: AssetView) => Promise<void>;
  handleCreateSqlTemplateFromAsset: (asset: AssetView) => Promise<void>;
  handleDeleteRule: (instruction: Instruction) => Promise<void>;
  handleDeleteSqlTemplate: (sqlPair: SqlPair) => Promise<void>;
  handleDuplicateRule: (instruction: Instruction) => Promise<void>;
  handleDuplicateSqlTemplate: (sqlPair: SqlPair) => Promise<void>;
  handleResetRuleDetailEditor: () => void;
  handleResetSqlTemplateEditor: () => void;
  handleSubmitRuleDetail: () => Promise<void>;
  handleSubmitSqlTemplateDetail: () => Promise<void>;
  handleWorkbenchSectionChange: (
    nextSection: KnowledgeWorkbenchSectionKey,
  ) => Promise<void>;
  openRuleEditor: (params: {
    instruction?: Instruction;
    draftValues?: Partial<{
      summary: string;
      scope: 'all' | 'matched';
      content: string;
    }>;
    contextAssetId?: string;
    switchSection?: boolean;
  }) => Promise<boolean>;
  openSqlTemplateEditor: (params: {
    sqlPair?: SqlPair;
    draftValues?: Partial<{
      sql: string;
      description: string;
    }>;
    contextAssetId?: string;
    switchSection?: boolean;
  }) => Promise<boolean>;
};
