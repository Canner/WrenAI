import type { Instruction } from '@/types/knowledge';
import type { AssetView } from '@/features/knowledgePage/types';
import type { KnowledgeWorkbenchSectionKey } from './knowledgeWorkbenchShared';

export type RuleDraftValues = Partial<{
  summary: string;
  scope: 'all' | 'matched';
  content: string;
}>;

export type KnowledgeWorkbenchRuleActionsArgs = {
  activeWorkbenchSection: KnowledgeWorkbenchSectionKey;
  editingInstruction?: Instruction | null;
  isRuleDraftDirty: boolean;
  isSqlDraftDirty: boolean;
  onChangeWorkbenchSection: (
    nextSection: KnowledgeWorkbenchSectionKey,
  ) => void | Promise<void>;
  onCreateRuleDraftFromAsset?: (asset: AssetView) => void;
  onDeleteRule: (instruction: Instruction) => Promise<void> | void;
  onOpenRuleDetail: (instruction?: Instruction) => void;
  onResetRuleDetailEditor: () => void;
  onSubmitRuleDetail: () => Promise<void> | void;
  ruleDrawerOpen: boolean;
  ruleForm: { setFieldsValue: (values: Record<string, any>) => void };
  syncRuleDraftBaseline: (values?: Record<string, any>) => void;
  setRuleContextAssetId: (value?: string) => void;
  setRuleDrawerOpen: (open: boolean) => void;
  ruleContextAsset?: AssetView | null;
  runWithDirtyGuard: (
    dirty: boolean,
    action: () => void | Promise<void>,
  ) => Promise<boolean>;
  confirmDeleteEntry: (entityLabel: string) => Promise<boolean>;
};

export type KnowledgeWorkbenchRuleActionCore = {
  applyContextDraft: () => void;
  handleCloseDrawer: () => Promise<boolean>;
  handleCreateFromAsset: (asset: AssetView) => Promise<void>;
  handleDeleteItem: (instruction: Instruction) => Promise<void>;
  handleDuplicateItem: (instruction: Instruction) => Promise<void>;
  handleResetEditor: () => void;
  handleSubmitDetail: () => Promise<void>;
};

export type KnowledgeWorkbenchRuleOpenEditorParams = {
  instruction?: Instruction;
  draftValues?: RuleDraftValues;
  contextAssetId?: string;
  switchSection?: boolean;
};
