import type {
  ConversationAidItem,
  ConversationAidPlan,
  HomeIntentKind,
  HomeIntentMode,
  ResponseArtifactLineage,
  ResponseArtifactPlan,
  ResolvedHomeIntent,
  WorkbenchArtifactKind,
} from '@/types/homeIntent';
import { getRecommendationTriggerLabel } from './homeRecommendationMessages';

type HomeIntentResponseLike = {
  id?: number | null;
  threadId?: number | null;
  responseKind?: string | null;
  sourceResponseId?: number | null;
  sql?: string | null;
  askingTask?: {
    type?: string | null;
  } | null;
  answerDetail?: {
    status?: string | null;
  } | null;
  breakdownDetail?: {
    status?: string | null;
  } | null;
  chartDetail?: {
    status?: string | null;
    chartSchema?: unknown;
    chartType?: string | null;
  } | null;
  recommendationDetail?: {
    status?: string | null;
    items?: Array<{
      label?: string | null;
      prompt?: string | null;
      suggestedIntent?: 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' | null;
    }> | null;
    sourceResponseId?: number | null;
  } | null;
  resolvedIntent?: ResolvedHomeIntent | null;
  artifactLineage?: ResponseArtifactLineage | null;
};

export const EMPTY_RESPONSE_ARTIFACT_PLAN: ResponseArtifactPlan = {
  teaserArtifacts: [],
  workbenchArtifacts: [],
  primaryTeaser: null,
  primaryWorkbenchArtifact: null,
};

const CHART_REFINE_AID_PROMPTS: Record<string, string[]> = {
  AREA: ['为面积图添加数据标签', '只保留最近 12 个时间点', '将标题改得更清晰'],
  BAR: ['为柱状图添加数据标签', '仅显示前 5 个柱子', '将标题改得更清晰'],
  GROUPED_BAR: [
    '为分组柱状图添加数据标签',
    '仅显示前 5 组数据',
    '将标题改得更清晰',
  ],
  LINE: ['为折线图添加数据标签', '只保留最近 12 个时间点', '将标题改得更清晰'],
  MULTI_LINE: [
    '为多折线图添加图例标签',
    '只保留最近 12 个时间点',
    '将标题改得更清晰',
  ],
  PIE: ['显示扇区百分比标签', '只保留前 5 个扇区', '将标题改得更清晰'],
  STACKED_BAR: [
    '为堆叠柱状图添加数据标签',
    '仅显示前 5 组数据',
    '将标题改得更清晰',
  ],
  DEFAULT: ['为图表添加数据标签', '只保留最重要的部分', '将标题改得更清晰'],
};

const pushUnique = <T>(items: T[], item: T | null | undefined) => {
  if (item == null || items.includes(item)) {
    return;
  }

  items.push(item);
};

const hasNonEmptySql = (sql?: string | null) =>
  typeof sql === 'string' && sql.trim().length > 0;

const hasRenderableChart = (
  chartDetail?: HomeIntentResponseLike['chartDetail'],
) => Boolean(chartDetail?.status === 'FINISHED' && chartDetail.chartSchema);

const resolveKindFromAskingTaskType = (
  type?: string | null,
): HomeIntentKind | null => {
  switch (type) {
    case 'GENERAL':
      return 'GENERAL_HELP';
    case 'MISLEADING_QUERY':
      return 'MISLEADING_QUERY';
    case 'TEXT_TO_SQL':
      return 'ASK';
    default:
      return null;
  }
};

const resolveMode = (
  response: HomeIntentResponseLike,
  kind: HomeIntentKind,
): HomeIntentMode => {
  if (kind === 'CHART' || kind === 'RECOMMEND_QUESTIONS') {
    return response.sourceResponseId != null ? 'FOLLOW_UP' : 'EXPLICIT_ACTION';
  }

  return response.sourceResponseId != null ? 'FOLLOW_UP' : 'NEW';
};

const buildConversationAid = ({
  interactionMode = 'draft_to_composer',
  kind,
  label,
  prompt,
  sourceResponseId,
  suggestedIntent,
}: {
  interactionMode?: ConversationAidItem['interactionMode'];
  kind: ConversationAidItem['kind'];
  label: string;
  prompt: string;
  sourceResponseId?: number | null;
  suggestedIntent?: ConversationAidItem['suggestedIntent'];
}): ConversationAidItem => ({
  interactionMode,
  kind,
  label,
  prompt,
  sourceResponseId: sourceResponseId ?? null,
  suggestedIntent: suggestedIntent ?? null,
});

const resolveConversationAidSourceResponseId = (
  response?: HomeIntentResponseLike | null,
) => response?.id ?? null;

const buildAskConversationAids = (
  response?: HomeIntentResponseLike | null,
): ConversationAidItem[] => {
  const sourceResponseId = resolveConversationAidSourceResponseId(response);
  const recommendationTriggerCopy = getRecommendationTriggerLabel();

  return [
    buildConversationAid({
      kind: 'TRIGGER_CHART_FOLLOWUP',
      label: '生成一张图表给我',
      prompt: '生成一张图表给我',
      sourceResponseId,
      suggestedIntent: 'CHART',
    }),
    buildConversationAid({
      kind: 'TRIGGER_RECOMMEND_QUESTIONS',
      label: recommendationTriggerCopy,
      prompt: recommendationTriggerCopy,
      sourceResponseId,
      suggestedIntent: 'RECOMMEND_QUESTIONS',
    }),
  ];
};

const resolveChartMarkType = (chartSchema?: unknown): string | null => {
  if (
    !chartSchema ||
    typeof chartSchema !== 'object' ||
    !('mark' in chartSchema)
  ) {
    return null;
  }

  const mark = (chartSchema as { mark?: unknown }).mark;
  if (typeof mark === 'string') {
    return mark.toUpperCase();
  }

  if (mark && typeof mark === 'object' && 'type' in mark) {
    const markType = (mark as { type?: string | null }).type;
    return typeof markType === 'string' ? markType.toUpperCase() : null;
  }

  return null;
};

const resolveChartAidPromptSet = (
  response?: HomeIntentResponseLike | null,
): string[] => {
  const explicitChartType =
    typeof response?.chartDetail?.chartType === 'string'
      ? response.chartDetail.chartType.toUpperCase()
      : null;
  if (explicitChartType && CHART_REFINE_AID_PROMPTS[explicitChartType]) {
    return CHART_REFINE_AID_PROMPTS[explicitChartType];
  }

  const chartMark = resolveChartMarkType(response?.chartDetail?.chartSchema);
  if (chartMark?.includes('BAR')) {
    return CHART_REFINE_AID_PROMPTS.BAR;
  }
  if (chartMark?.includes('LINE')) {
    return CHART_REFINE_AID_PROMPTS.LINE;
  }
  if (chartMark?.includes('AREA')) {
    return CHART_REFINE_AID_PROMPTS.AREA;
  }
  if (chartMark?.includes('ARC') || chartMark?.includes('PIE')) {
    return CHART_REFINE_AID_PROMPTS.PIE;
  }

  return CHART_REFINE_AID_PROMPTS.DEFAULT;
};

const buildChartConversationAids = (
  response?: HomeIntentResponseLike | null,
): ConversationAidItem[] => {
  const sourceResponseId = resolveConversationAidSourceResponseId(response);
  const recommendationTriggerCopy = getRecommendationTriggerLabel();

  return [
    ...resolveChartAidPromptSet(response).map((prompt) =>
      buildConversationAid({
        kind: 'TRIGGER_CHART_REFINE',
        label: prompt,
        prompt,
        sourceResponseId,
        suggestedIntent: 'CHART',
      }),
    ),
    buildConversationAid({
      kind: 'TRIGGER_RECOMMEND_QUESTIONS',
      label: recommendationTriggerCopy,
      prompt: recommendationTriggerCopy,
      sourceResponseId,
      suggestedIntent: 'RECOMMEND_QUESTIONS',
    }),
  ];
};

export const resolveDefaultConversationAidPlanForIntent = (
  kind: HomeIntentKind,
  response?: HomeIntentResponseLike | null,
): ConversationAidPlan | null => {
  switch (kind) {
    case 'ASK':
      return {
        responseAids: buildAskConversationAids(response),
      };
    case 'CHART':
      return {
        responseAids: buildChartConversationAids(response),
      };
    default:
      return null;
  }
};

export const resolveDefaultArtifactPlanForIntent = (
  kind: HomeIntentKind,
): ResponseArtifactPlan => {
  switch (kind) {
    case 'ASK':
      return {
        teaserArtifacts: ['preview_teaser'],
        workbenchArtifacts: ['preview', 'sql'],
        primaryTeaser: 'preview_teaser',
        primaryWorkbenchArtifact: 'preview',
      };
    case 'CHART':
      return {
        teaserArtifacts: ['chart_teaser'],
        workbenchArtifacts: ['chart', 'preview', 'sql'],
        primaryTeaser: 'chart_teaser',
        primaryWorkbenchArtifact: 'chart',
      };
    default:
      return { ...EMPTY_RESPONSE_ARTIFACT_PLAN };
  }
};

export const resolveResponseArtifactPlan = (
  response?: HomeIntentResponseLike | null,
): ResponseArtifactPlan => {
  if (!response) {
    return { ...EMPTY_RESPONSE_ARTIFACT_PLAN };
  }

  if (response.resolvedIntent?.artifactPlan) {
    return response.resolvedIntent.artifactPlan;
  }

  const teaserArtifacts: ResponseArtifactPlan['teaserArtifacts'] = [];
  const workbenchArtifacts: WorkbenchArtifactKind[] = [];
  const isChartFollowUp = response.responseKind === 'CHART_FOLLOWUP';
  const isRecommendationFollowUp =
    response.responseKind === 'RECOMMENDATION_FOLLOWUP';
  const hasSql = hasNonEmptySql(response.sql);
  const hasChart = hasRenderableChart(response.chartDetail);
  const inheritsSourceArtifacts =
    isChartFollowUp && response.sourceResponseId != null;

  if (isRecommendationFollowUp) {
    return {
      teaserArtifacts,
      workbenchArtifacts,
      primaryTeaser: null,
      primaryWorkbenchArtifact: null,
    };
  }

  if (isChartFollowUp) {
    pushUnique(teaserArtifacts, 'chart_teaser');
    if (hasChart) {
      pushUnique(workbenchArtifacts, 'chart');
    }
    if (hasSql || inheritsSourceArtifacts) {
      pushUnique(workbenchArtifacts, 'preview');
      pushUnique(workbenchArtifacts, 'sql');
    }
  } else {
    if (hasSql) {
      pushUnique(teaserArtifacts, 'preview_teaser');
      pushUnique(workbenchArtifacts, 'preview');
      pushUnique(workbenchArtifacts, 'sql');
    }
    if (hasChart) {
      pushUnique(workbenchArtifacts, 'chart');
    }
  }

  return {
    teaserArtifacts,
    workbenchArtifacts,
    primaryTeaser: teaserArtifacts[0] || null,
    primaryWorkbenchArtifact: workbenchArtifacts[0] || null,
  };
};

export const resolveResponseArtifactLineage = (
  response?: HomeIntentResponseLike | null,
): ResponseArtifactLineage | null => {
  if (!response) {
    return null;
  }

  if (response.artifactLineage) {
    return response.artifactLineage;
  }

  if (
    response.responseKind === 'CHART_FOLLOWUP' &&
    response.sourceResponseId != null
  ) {
    return {
      sourceResponseId: response.sourceResponseId,
      inheritedWorkbenchArtifacts: ['preview', 'sql'],
    };
  }

  if (
    response.responseKind === 'RECOMMENDATION_FOLLOWUP' &&
    response.sourceResponseId != null
  ) {
    return {
      sourceResponseId: response.sourceResponseId,
      inheritedWorkbenchArtifacts: null,
    };
  }

  if (response.sourceResponseId != null) {
    return {
      sourceResponseId: response.sourceResponseId,
      inheritedWorkbenchArtifacts: null,
    };
  }

  return null;
};

export const resolveResponseHomeIntent = (
  response?: HomeIntentResponseLike | null,
): ResolvedHomeIntent | null => {
  if (!response) {
    return null;
  }

  if (response.resolvedIntent) {
    return response.resolvedIntent;
  }

  const kind =
    response.responseKind === 'CHART_FOLLOWUP'
      ? 'CHART'
      : response.responseKind === 'RECOMMENDATION_FOLLOWUP'
        ? 'RECOMMEND_QUESTIONS'
        : resolveKindFromAskingTaskType(response.askingTask?.type) ||
          (response.askingTask ||
          response.answerDetail ||
          response.breakdownDetail ||
          response.chartDetail ||
          hasNonEmptySql(response.sql)
            ? 'ASK'
            : 'GENERAL_HELP');

  return {
    kind,
    mode: resolveMode(response, kind),
    target: 'THREAD_RESPONSE',
    source: resolveKindFromAskingTaskType(response.askingTask?.type)
      ? 'classifier'
      : 'derived',
    sourceThreadId: response.threadId ?? null,
    sourceResponseId: response.sourceResponseId ?? null,
    confidence: null,
    artifactPlan: resolveResponseArtifactPlan(response),
    conversationAidPlan: resolveDefaultConversationAidPlanForIntent(
      kind,
      response,
    ),
  };
};

export const resolveRecommendedQuestionsHomeIntent = ({
  source,
  sourceResponseId,
  sourceThreadId,
  target = 'THREAD_SIDECAR',
}: {
  source?: ResolvedHomeIntent['source'];
  sourceResponseId?: number | null;
  sourceThreadId?: number | null;
  target?: ResolvedHomeIntent['target'];
}): ResolvedHomeIntent => ({
  kind: 'RECOMMEND_QUESTIONS',
  mode: sourceResponseId != null ? 'FOLLOW_UP' : 'EXPLICIT_ACTION',
  target,
  source: source || 'derived',
  sourceThreadId: sourceThreadId ?? null,
  sourceResponseId: sourceResponseId ?? null,
  confidence: null,
  artifactPlan: { ...EMPTY_RESPONSE_ARTIFACT_PLAN },
  conversationAidPlan: {
    threadAids: ['suggested_questions'],
  },
});

export type HydratedHomeIntentResponse<T extends HomeIntentResponseLike> = Omit<
  T,
  'resolvedIntent' | 'artifactLineage'
> & {
  resolvedIntent: ResolvedHomeIntent;
  artifactLineage: ResponseArtifactLineage | null;
};

export const hydrateThreadResponseHomeIntent = <
  T extends HomeIntentResponseLike,
>(
  response: T,
): HydratedHomeIntentResponse<T> => {
  const resolvedIntent = resolveResponseHomeIntent(response);
  const artifactLineage = resolveResponseArtifactLineage({
    ...response,
    resolvedIntent,
  });

  return {
    ...response,
    resolvedIntent: resolvedIntent as ResolvedHomeIntent,
    artifactLineage,
  };
};

export const hydrateThreadResponsesHomeIntent = <
  T extends HomeIntentResponseLike,
>(
  responses?: T[] | null,
): HydratedHomeIntentResponse<T>[] =>
  (responses || []).map((response) =>
    hydrateThreadResponseHomeIntent(response),
  );
