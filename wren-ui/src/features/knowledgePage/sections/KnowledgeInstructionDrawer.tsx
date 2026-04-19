import type { AssetView } from '@/features/knowledgePage/types';

import KnowledgeInstructionFormFields from './KnowledgeInstructionFormFields';
import KnowledgeWorkbenchAssetEditorDrawer from './KnowledgeWorkbenchAssetEditorDrawer';

type KnowledgeInstructionDrawerProps = {
  assetOptions: Array<{ label: string; value: string }>;
  createInstructionLoading: boolean;
  isKnowledgeMutationDisabled: boolean;
  open: boolean;
  ruleContextAsset?: AssetView | null;
  ruleContextAssetId?: string;
  ruleForm: any;
  updateInstructionLoading: boolean;
  onApplyRuleContextDraft: () => void;
  onCloseDrawer: () => void | Promise<void>;
  onCreateSqlTemplateFromAsset: (asset: AssetView) => void | Promise<void>;
  onResetRuleDetailEditor: () => void;
  onRuleContextAssetChange: (value?: string) => void;
  onSubmitRuleDetail: () => void | Promise<void>;
};

export default function KnowledgeInstructionDrawer({
  assetOptions,
  createInstructionLoading,
  isKnowledgeMutationDisabled,
  open,
  ruleContextAsset,
  ruleContextAssetId,
  ruleForm,
  updateInstructionLoading,
  onApplyRuleContextDraft,
  onCloseDrawer,
  onCreateSqlTemplateFromAsset,
  onResetRuleDetailEditor,
  onRuleContextAssetChange,
  onSubmitRuleDetail,
}: KnowledgeInstructionDrawerProps) {
  return (
    <KnowledgeWorkbenchAssetEditorDrawer
      actions={[
        { label: '带入规则草稿', onClick: () => onApplyRuleContextDraft() },
        { label: '去沉淀 SQL 模板', onClick: onCreateSqlTemplateFromAsset },
      ]}
      asset={ruleContextAsset}
      assetMeta={`主键 ${ruleContextAsset?.primaryKey || '未声明'} · ${
        ruleContextAsset?.fieldCount || 0
      } 个字段`}
      assetOptions={assetOptions}
      form={ruleForm}
      isReadonly={isKnowledgeMutationDisabled}
      loading={createInstructionLoading || updateInstructionLoading}
      open={open}
      placeholder="选择一个资产，把推荐问法和治理提示带进来"
      questionField="summary"
      saveLabel="保存分析规则"
      selectedAssetId={ruleContextAssetId}
      onAssetChange={onRuleContextAssetChange}
      onClose={onCloseDrawer}
      onReset={onResetRuleDetailEditor}
      onSubmit={onSubmitRuleDetail}
    >
      <KnowledgeInstructionFormFields
        isReadonly={isKnowledgeMutationDisabled}
        ruleForm={ruleForm}
      />
    </KnowledgeWorkbenchAssetEditorDrawer>
  );
}
