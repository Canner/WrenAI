import type { AssetView } from '@/features/knowledgePage/types';
import type { Instruction } from '@/types/knowledge';

import KnowledgeInstructionsSection from './KnowledgeInstructionsSection';

export type KnowledgeInstructionsStageProps = {
  applyRuleContextDraft: () => void;
  assetOptions: Array<{ label: string; value: string }>;
  createInstructionLoading: boolean;
  editingInstruction?: Instruction | null;
  handleCloseRuleDrawer: () => void | Promise<void | boolean>;
  handleCreateSqlTemplateFromAsset: (
    asset: AssetView,
  ) => void | Promise<void | boolean>;
  handleDeleteRule: (
    instruction: Instruction,
  ) => void | Promise<void | boolean>;
  handleDuplicateRule: (
    instruction: Instruction,
  ) => void | Promise<void | boolean>;
  handleResetRuleDetailEditor: () => void;
  handleSubmitRuleDetail: () => Promise<void | boolean> | void;
  isKnowledgeMutationDisabled: boolean;
  openRuleEditor: (input: {
    instruction?: Instruction;
    switchSection?: boolean;
  }) => void | Promise<void | boolean>;
  ruleContextAsset?: AssetView | null;
  ruleContextAssetId?: string;
  ruleDrawerOpen: boolean;
  ruleForm: any;
  ruleList: Instruction[];
  ruleListScope: 'all' | 'default' | 'matched';
  ruleManageLoading: boolean;
  ruleSearchKeyword: string;
  setRuleContextAssetId: (value?: string) => void;
  setRuleListScope: (scope: 'all' | 'default' | 'matched') => void;
  setRuleSearchKeyword: (value: string) => void;
  updateInstructionLoading: boolean;
  visibleRuleList: Instruction[];
};

export default function KnowledgeInstructionsStage({
  applyRuleContextDraft,
  assetOptions,
  createInstructionLoading,
  editingInstruction,
  handleCloseRuleDrawer,
  handleCreateSqlTemplateFromAsset,
  handleDeleteRule,
  handleDuplicateRule,
  handleResetRuleDetailEditor,
  handleSubmitRuleDetail,
  isKnowledgeMutationDisabled,
  openRuleEditor,
  ruleContextAsset,
  ruleContextAssetId,
  ruleDrawerOpen,
  ruleForm,
  ruleList,
  ruleListScope,
  ruleManageLoading,
  ruleSearchKeyword,
  setRuleContextAssetId,
  setRuleListScope,
  setRuleSearchKeyword,
  updateInstructionLoading,
  visibleRuleList,
}: KnowledgeInstructionsStageProps) {
  return (
    <KnowledgeInstructionsSection
      assetOptions={assetOptions}
      createInstructionLoading={createInstructionLoading}
      editingInstruction={editingInstruction}
      isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
      ruleContextAsset={ruleContextAsset}
      ruleContextAssetId={ruleContextAssetId}
      ruleDrawerOpen={ruleDrawerOpen}
      ruleForm={ruleForm}
      ruleList={ruleList}
      ruleListScope={ruleListScope}
      ruleManageLoading={ruleManageLoading}
      ruleSearchKeyword={ruleSearchKeyword}
      updateInstructionLoading={updateInstructionLoading}
      visibleRuleList={visibleRuleList}
      onApplyRuleContextDraft={applyRuleContextDraft}
      onCloseDrawer={() => void handleCloseRuleDrawer()}
      onCreateRule={() => void openRuleEditor({})}
      onCreateSqlTemplateFromAsset={(asset) =>
        void handleCreateSqlTemplateFromAsset(asset)
      }
      onDeleteRule={(instruction) => void handleDeleteRule(instruction)}
      onDuplicateRule={(instruction) => void handleDuplicateRule(instruction)}
      onResetRuleDetailEditor={handleResetRuleDetailEditor}
      onRuleContextAssetChange={setRuleContextAssetId}
      onScopeChange={setRuleListScope}
      onSearchKeywordChange={setRuleSearchKeyword}
      onSelectRule={(instruction) =>
        void openRuleEditor({ instruction, switchSection: false })
      }
      onSubmitRuleDetail={() => void handleSubmitRuleDetail()}
    />
  );
}
