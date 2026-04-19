import { Typography } from 'antd';

import {
  WorkbenchEditorRail,
  WorkbenchSectionPanel,
} from '@/features/knowledgePage/index.styles';
import type { AssetView } from '@/features/knowledgePage/types';
import type { Instruction } from '@/types/knowledge';

import KnowledgeInstructionDrawer from './KnowledgeInstructionDrawer';
import KnowledgeInstructionList from './KnowledgeInstructionList';

const { Text } = Typography;

type KnowledgeInstructionsSectionProps = {
  ruleManageLoading: boolean;
  visibleRuleList: Instruction[];
  ruleList: Instruction[];
  ruleListScope: 'all' | 'default' | 'matched';
  ruleSearchKeyword: string;
  ruleDrawerOpen: boolean;
  editingInstruction?: Instruction | null;
  isKnowledgeMutationDisabled: boolean;
  assetOptions: Array<{ label: string; value: string }>;
  ruleContextAssetId?: string;
  ruleContextAsset?: AssetView | null;
  ruleForm: any;
  createInstructionLoading: boolean;
  updateInstructionLoading: boolean;
  onSearchKeywordChange: (value: string) => void;
  onScopeChange: (scope: 'all' | 'default' | 'matched') => void;
  onCreateRule: () => void;
  onSelectRule: (instruction: Instruction) => void;
  onDuplicateRule: (instruction: Instruction) => void | Promise<void>;
  onDeleteRule: (instruction: Instruction) => void | Promise<void>;
  onCloseDrawer: () => void | Promise<void>;
  onRuleContextAssetChange: (value?: string) => void;
  onApplyRuleContextDraft: () => void;
  onCreateSqlTemplateFromAsset: (asset: AssetView) => void | Promise<void>;
  onSubmitRuleDetail: () => void | Promise<void>;
  onResetRuleDetailEditor: () => void;
};

export default function KnowledgeInstructionsSection(
  props: KnowledgeInstructionsSectionProps,
) {
  const {
    ruleManageLoading,
    visibleRuleList,
    ruleList,
    ruleListScope,
    ruleSearchKeyword,
    ruleDrawerOpen,
    editingInstruction,
    isKnowledgeMutationDisabled,
    assetOptions,
    ruleContextAssetId,
    ruleContextAsset,
    ruleForm,
    createInstructionLoading,
    updateInstructionLoading,
    onSearchKeywordChange,
    onScopeChange,
    onCreateRule,
    onSelectRule,
    onDuplicateRule,
    onDeleteRule,
    onCloseDrawer,
    onRuleContextAssetChange,
    onApplyRuleContextDraft,
    onCreateSqlTemplateFromAsset,
    onSubmitRuleDetail,
    onResetRuleDetailEditor,
  } = props;

  return (
    <WorkbenchSectionPanel>
      {ruleManageLoading ? (
        <Text type="secondary">正在加载分析规则…</Text>
      ) : (
        <>
          <WorkbenchEditorRail>
            <KnowledgeInstructionList
              editingInstruction={editingInstruction}
              isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
              ruleDrawerOpen={ruleDrawerOpen}
              ruleList={ruleList}
              ruleListScope={ruleListScope}
              ruleSearchKeyword={ruleSearchKeyword}
              visibleRuleList={visibleRuleList}
              onCreateRule={onCreateRule}
              onDeleteRule={onDeleteRule}
              onDuplicateRule={onDuplicateRule}
              onScopeChange={onScopeChange}
              onSearchKeywordChange={onSearchKeywordChange}
              onSelectRule={onSelectRule}
            />
          </WorkbenchEditorRail>
          <KnowledgeInstructionDrawer
            assetOptions={assetOptions}
            createInstructionLoading={createInstructionLoading}
            isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
            open={ruleDrawerOpen}
            ruleContextAsset={ruleContextAsset}
            ruleContextAssetId={ruleContextAssetId}
            ruleForm={ruleForm}
            updateInstructionLoading={updateInstructionLoading}
            onApplyRuleContextDraft={onApplyRuleContextDraft}
            onCloseDrawer={onCloseDrawer}
            onCreateSqlTemplateFromAsset={onCreateSqlTemplateFromAsset}
            onResetRuleDetailEditor={onResetRuleDetailEditor}
            onRuleContextAssetChange={onRuleContextAssetChange}
            onSubmitRuleDetail={onSubmitRuleDetail}
          />
        </>
      )}
    </WorkbenchSectionPanel>
  );
}
