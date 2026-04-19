import type { Instruction } from '@/types/knowledge';

import KnowledgeInstructionCardGrid from './KnowledgeInstructionCardGrid';
import KnowledgeWorkbenchEditorEmptyState from './KnowledgeWorkbenchEditorEmptyState';
import KnowledgeWorkbenchEditorRailControls from './KnowledgeWorkbenchEditorRailControls';

const RULE_FILTER_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'default', label: '默认规则' },
  { key: 'matched', label: '匹配问题' },
] as const;

type KnowledgeInstructionListProps = {
  editingInstruction?: Instruction | null;
  isKnowledgeMutationDisabled: boolean;
  ruleDrawerOpen: boolean;
  ruleList: Instruction[];
  ruleListScope: 'all' | 'default' | 'matched';
  ruleSearchKeyword: string;
  visibleRuleList: Instruction[];
  onCreateRule: () => void;
  onDeleteRule: (instruction: Instruction) => void | Promise<void>;
  onDuplicateRule: (instruction: Instruction) => void | Promise<void>;
  onScopeChange: (scope: 'all' | 'default' | 'matched') => void;
  onSearchKeywordChange: (value: string) => void;
  onSelectRule: (instruction: Instruction) => void;
};

export default function KnowledgeInstructionList({
  editingInstruction,
  isKnowledgeMutationDisabled,
  ruleDrawerOpen,
  ruleList,
  ruleListScope,
  ruleSearchKeyword,
  visibleRuleList,
  onCreateRule,
  onDeleteRule,
  onDuplicateRule,
  onScopeChange,
  onSearchKeywordChange,
  onSelectRule,
}: KnowledgeInstructionListProps) {
  const hasVisibleContent =
    visibleRuleList.length > 0 || !isKnowledgeMutationDisabled;

  return (
    <>
      <KnowledgeWorkbenchEditorRailControls
        activeFilter={ruleListScope}
        filterOptions={[...RULE_FILTER_OPTIONS]}
        searchPlaceholder="搜索规则名称、首条问法或规则内容"
        searchValue={ruleSearchKeyword}
        visibleCount={visibleRuleList.length}
        totalCount={ruleList.length}
        onFilterChange={(scope) =>
          onScopeChange(scope as 'all' | 'default' | 'matched')
        }
        onSearchChange={onSearchKeywordChange}
      />
      {hasVisibleContent ? (
        <KnowledgeInstructionCardGrid
          editingInstruction={editingInstruction}
          isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
          ruleDrawerOpen={ruleDrawerOpen}
          visibleRuleList={visibleRuleList}
          onCreateRule={onCreateRule}
          onDeleteRule={onDeleteRule}
          onDuplicateRule={onDuplicateRule}
          onSelectRule={onSelectRule}
        />
      ) : (
        <KnowledgeWorkbenchEditorEmptyState
          title={
            ruleList.length > 0 ? '没有匹配的分析规则' : '先创建第一条分析规则'
          }
          description={
            ruleList.length > 0
              ? '试试更换关键字，或切换“默认规则 / 匹配问题”过滤条件。'
              : '先新增规则，再在右侧抽屉里补充业务口径与适用方式。'
          }
        />
      )}
    </>
  );
}
