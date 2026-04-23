import { Path } from '@/utils/enum';
import { buildKnowledgeWorkbenchParams } from '@/utils/knowledgeWorkbench';

export const MODELING_ASSISTANT_PATHS = [
  Path.RecommendRelationships,
  Path.RecommendSemantics,
] as const;

export const MODELING_ASSISTANT_ROUTE_TITLES = {
  [Path.RecommendRelationships]: 'Generate relationships',
  [Path.RecommendSemantics]: 'Generate semantics',
} as const;

export const buildModelingAssistantBackParams = () =>
  buildKnowledgeWorkbenchParams('modeling');
