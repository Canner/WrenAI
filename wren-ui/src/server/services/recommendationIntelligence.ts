import type { PreviewDataResponse } from './queryService';

export type RecommendationItemCategory =
  | 'drill_down'
  | 'compare'
  | 'trend'
  | 'distribution'
  | 'ranking'
  | 'chart_followup'
  | 'chart_refine'
  | 'related_question';

export type RecommendationSuggestedIntent =
  | 'ASK'
  | 'CHART'
  | 'RECOMMEND_QUESTIONS';

export type RecommendationInteractionMode =
  | 'draft_to_composer'
  | 'execute_intent';

export type RecommendationPreviewColumn = {
  name: string;
  role: 'dimension' | 'measure';
  type?: string | null;
};

type RawRecommendationItem = {
  category?: string | null;
  interactionMode?: string | null;
  interaction_mode?: string | null;
  label?: string | null;
  prompt?: string | null;
  question?: string | null;
  sql?: string | null;
  suggestedIntent?: string | null;
  suggested_intent?: string | null;
};

const NUMERIC_TYPE_PATTERN =
  /(int|integer|bigint|smallint|decimal|numeric|double|float|real|number)/i;
const TREND_PATTERN =
  /(趋势|变化|按月|按周|按日|按年|时间|同比|环比|trend|over time|monthly|weekly|daily|yearly|month over month|quarter)/i;
const COMPARE_PATTERN =
  /(对比|比较|相比|差异|compare|comparison|versus|\bvs\b|against)/i;
const DISTRIBUTION_PATTERN =
  /(分布|占比|比例|构成|share|distribution|breakdown|composition|百分比|percent)/i;
const RANKING_PATTERN =
  /(\btop\b|\bbottom\b|排名|排行|最高|最低|前\d+|后\d+|largest|smallest|highest|lowest|rank)/i;
const DRILL_DOWN_PATTERN =
  /(细分|拆分|明细|按.+(分组|拆分)|哪些|哪个|drill|break down|slice|segment|segmentation)/i;
const CHART_PATTERN =
  /(图表|图形|可视化|柱状图|折线图|饼图|面积图|散点图|chart|graph|plot|visual)/i;

const STRUCTURED_CATEGORY_SET = new Set<RecommendationItemCategory>([
  'drill_down',
  'compare',
  'trend',
  'distribution',
  'ranking',
  'chart_followup',
  'chart_refine',
  'related_question',
]);

const STRUCTURED_INTENT_SET = new Set<RecommendationSuggestedIntent>([
  'ASK',
  'CHART',
  'RECOMMEND_QUESTIONS',
]);

const STRUCTURED_INTERACTION_MODE_SET = new Set<RecommendationInteractionMode>([
  'draft_to_composer',
  'execute_intent',
]);

const normalizeText = (value?: string | null) => value?.trim() || '';

export const isNumericPreviewType = (type?: string | null) =>
  typeof type === 'string' && NUMERIC_TYPE_PATTERN.test(type);

export const summarizePreviewData = (
  previewData?: PreviewDataResponse | null,
): {
  previewColumnCount?: number;
  previewColumns: RecommendationPreviewColumn[];
  previewRowCount?: number;
} => {
  const previewPayload: Partial<PreviewDataResponse> = previewData ?? {};
  const columns = Array.isArray(previewPayload.columns)
    ? previewPayload.columns
    : [];
  const previewColumns = columns.map((column) => ({
    name: column.name,
    type: column.type || null,
    role: isNumericPreviewType(column.type)
      ? ('measure' as RecommendationPreviewColumn['role'])
      : ('dimension' as RecommendationPreviewColumn['role']),
  }));

  return {
    previewColumnCount: previewColumns.length || undefined,
    previewColumns,
    previewRowCount: Array.isArray(previewPayload.data)
      ? previewPayload.data.length
      : undefined,
  };
};

export const normalizeRecommendationInteractionMode = (
  mode?: string | null,
): RecommendationInteractionMode =>
  STRUCTURED_INTERACTION_MODE_SET.has(
    (mode || '') as RecommendationInteractionMode,
  )
    ? ((mode || 'draft_to_composer') as RecommendationInteractionMode)
    : 'draft_to_composer';

export const normalizeRecommendationCategory = ({
  rawCategory,
  question,
  suggestedIntent,
}: {
  rawCategory?: string | null;
  question?: string | null;
  suggestedIntent?: string | null;
}): RecommendationItemCategory => {
  if (
    rawCategory &&
    STRUCTURED_CATEGORY_SET.has(rawCategory as RecommendationItemCategory)
  ) {
    return rawCategory as RecommendationItemCategory;
  }

  const normalizedQuestion = normalizeText(question);
  const normalizedCategory = normalizeText(rawCategory).toLowerCase();

  if (suggestedIntent === 'CHART' || CHART_PATTERN.test(normalizedQuestion)) {
    return /refine|调整|优化|换一种图|switch chart|change chart/i.test(
      `${normalizedCategory} ${normalizedQuestion}`,
    )
      ? 'chart_refine'
      : 'chart_followup';
  }

  if (
    TREND_PATTERN.test(normalizedQuestion) ||
    /trend|time/.test(normalizedCategory)
  ) {
    return 'trend';
  }

  if (
    COMPARE_PATTERN.test(normalizedQuestion) ||
    /compar/.test(normalizedCategory)
  ) {
    return 'compare';
  }

  if (
    DISTRIBUTION_PATTERN.test(normalizedQuestion) ||
    /distribution|share|composition|quality/.test(normalizedCategory)
  ) {
    return 'distribution';
  }

  if (
    RANKING_PATTERN.test(normalizedQuestion) ||
    /rank|top|bottom/.test(normalizedCategory)
  ) {
    return 'ranking';
  }

  if (
    DRILL_DOWN_PATTERN.test(normalizedQuestion) ||
    /segment|descriptive/.test(normalizedCategory)
  ) {
    return 'drill_down';
  }

  return 'related_question';
};

export const normalizeRecommendationSuggestedIntent = ({
  category,
  question,
  suggestedIntent,
}: {
  category: RecommendationItemCategory;
  question?: string | null;
  suggestedIntent?: string | null;
}): RecommendationSuggestedIntent => {
  if (
    suggestedIntent &&
    STRUCTURED_INTENT_SET.has(suggestedIntent as RecommendationSuggestedIntent)
  ) {
    return suggestedIntent as RecommendationSuggestedIntent;
  }

  if (
    category === 'chart_followup' ||
    category === 'chart_refine' ||
    CHART_PATTERN.test(normalizeText(question))
  ) {
    return 'CHART';
  }

  return 'ASK';
};

export const toStructuredRecommendationItem = (
  item: RawRecommendationItem,
): {
  category: RecommendationItemCategory;
  interactionMode: RecommendationInteractionMode;
  label: string;
  prompt: string;
  sql?: string | null;
  suggestedIntent: RecommendationSuggestedIntent;
} | null => {
  const prompt = normalizeText(item.prompt || item.question || item.label);
  if (!prompt) {
    return null;
  }

  const label = normalizeText(item.label) || prompt;
  const category = normalizeRecommendationCategory({
    rawCategory: item.category,
    question: prompt,
    suggestedIntent: item.suggestedIntent || item.suggested_intent,
  });

  return {
    category,
    interactionMode: normalizeRecommendationInteractionMode(
      item.interactionMode || item.interaction_mode,
    ),
    label,
    prompt,
    sql: item.sql || null,
    suggestedIntent: normalizeRecommendationSuggestedIntent({
      category,
      question: prompt,
      suggestedIntent: item.suggestedIntent || item.suggested_intent,
    }),
  };
};
