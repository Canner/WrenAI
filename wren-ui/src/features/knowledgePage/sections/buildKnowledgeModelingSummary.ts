import type { KnowledgeWorkbenchModelingSummary } from '@/features/knowledgePage/sections/knowledgeWorkbenchShared';

type KnowledgeDiagramSummaryInput = {
  models?: Array<{
    relationFields?: Array<{
      relationId?: number | null;
    } | null> | null;
  } | null> | null;
  views?: Array<unknown> | null;
} | null;

export const buildKnowledgeModelingSummary = (
  diagram?: KnowledgeDiagramSummaryInput,
): KnowledgeWorkbenchModelingSummary => {
  const relationIds = new Set<number>();

  (diagram?.models || []).forEach((model) => {
    (model?.relationFields || []).forEach((field) => {
      if (typeof field?.relationId === 'number') {
        relationIds.add(field.relationId);
      }
    });
  });

  return {
    modelCount: diagram?.models?.length || 0,
    viewCount: diagram?.views?.length || 0,
    relationCount: relationIds.size,
  };
};
