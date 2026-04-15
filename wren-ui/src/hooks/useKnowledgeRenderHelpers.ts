import { getReferenceDemoKnowledgeByName } from '@/utils/referenceDemoKnowledge';
import { parseInstructionDraft } from './useKnowledgeRuleSqlManager';

type SidebarKnowledgeItemLike = {
  name: string;
  demo?: boolean;
  record?: unknown;
  assetCount?: number | null;
};

type InstructionLike = Parameters<typeof parseInstructionDraft>[0];

export const isDemoKnowledgeSidebarEntry = (item: SidebarKnowledgeItemLike) =>
  Boolean(item.demo || !item.record);

export const resolveKnowledgeSidebarFallbackAssetCount = (
  item: SidebarKnowledgeItemLike,
) =>
  item.assetCount ??
  getReferenceDemoKnowledgeByName(item.name)?.snapshotCount ??
  0;

export const resolveRuleDraftSummary = (instruction: InstructionLike) =>
  parseInstructionDraft(instruction).summary;

export const resolveRuleDraftContent = (instruction: InstructionLike) =>
  parseInstructionDraft(instruction).content;

export const resolveRuleDraftDisplay = (instruction: InstructionLike) => {
  const draft = parseInstructionDraft(instruction);
  return {
    summary: draft.summary,
    content: draft.content,
  };
};
