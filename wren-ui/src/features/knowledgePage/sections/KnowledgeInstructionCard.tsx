import { parseInstructionDraft } from '@/hooks/useKnowledgeRuleSqlManager';
import type { Instruction } from '@/types/knowledge';
import { formatKnowledgeWorkbenchTimestamp } from '@/utils/knowledgeWorkbenchEditor';

import KnowledgeWorkbenchEditorItemCard from './KnowledgeWorkbenchEditorItemCard';

const resolveRuleCardStatus = (instruction: Instruction) =>
  instruction.isDefault ? '默认规则' : '匹配问题';

type KnowledgeInstructionCardProps = {
  active: boolean;
  instruction: Instruction;
  isKnowledgeMutationDisabled: boolean;
  onDeleteRule: (instruction: Instruction) => void | Promise<void>;
  onDuplicateRule: (instruction: Instruction) => void | Promise<void>;
  onSelectRule: (instruction: Instruction) => void;
};

export default function KnowledgeInstructionCard({
  active,
  instruction,
  isKnowledgeMutationDisabled,
  onDeleteRule,
  onDuplicateRule,
  onSelectRule,
}: KnowledgeInstructionCardProps) {
  const draft = parseInstructionDraft(instruction);

  return (
    <KnowledgeWorkbenchEditorItemCard
      active={active}
      deleteTitle="删除分析规则"
      description={draft.content || '暂无规则内容'}
      duplicateTitle="复制为新草稿"
      isReadonly={isKnowledgeMutationDisabled}
      metaText={`更新于 ${formatKnowledgeWorkbenchTimestamp(
        instruction.updatedAt || instruction.createdAt,
      )}`}
      statusLabel={resolveRuleCardStatus(instruction)}
      statusTone={instruction.isDefault ? 'accent' : 'default'}
      title={draft.summary || '未命名规则'}
      onDelete={() => onDeleteRule(instruction)}
      onDuplicate={() => onDuplicateRule(instruction)}
      onSelect={() => onSelectRule(instruction)}
    />
  );
}
