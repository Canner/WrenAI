import { WorkbenchEditorCardGrid } from '@/features/knowledgePage/index.styles';
import type { Instruction } from '@/types/knowledge';

import KnowledgeInstructionCard from './KnowledgeInstructionCard';
import KnowledgeWorkbenchCreateEditorCard from './KnowledgeWorkbenchCreateEditorCard';

type KnowledgeInstructionCardGridProps = {
  editingInstruction?: Instruction | null;
  isKnowledgeMutationDisabled: boolean;
  ruleDrawerOpen: boolean;
  visibleRuleList: Instruction[];
  onCreateRule: () => void;
  onDeleteRule: (instruction: Instruction) => void | Promise<void>;
  onDuplicateRule: (instruction: Instruction) => void | Promise<void>;
  onSelectRule: (instruction: Instruction) => void;
};

export default function KnowledgeInstructionCardGrid({
  editingInstruction,
  isKnowledgeMutationDisabled,
  ruleDrawerOpen,
  visibleRuleList,
  onCreateRule,
  onDeleteRule,
  onDuplicateRule,
  onSelectRule,
}: KnowledgeInstructionCardGridProps) {
  return (
    <WorkbenchEditorCardGrid>
      {!isKnowledgeMutationDisabled ? (
        <KnowledgeWorkbenchCreateEditorCard
          title="新建分析规则"
          description="补一条业务口径或匹配问法规则，让知识库回答更稳定。"
          onClick={onCreateRule}
        />
      ) : null}
      {visibleRuleList.map((instruction) => (
        <KnowledgeInstructionCard
          key={instruction.id}
          active={ruleDrawerOpen && editingInstruction?.id === instruction.id}
          instruction={instruction}
          isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
          onDeleteRule={onDeleteRule}
          onDuplicateRule={onDuplicateRule}
          onSelectRule={onSelectRule}
        />
      ))}
    </WorkbenchEditorCardGrid>
  );
}
