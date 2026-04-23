import {
  RecommendationQuestionStatus,
  WrenAILanguage,
} from '@server/models/adaptor';
import {
  normalizeCanonicalPersistedRuntimeIdentity,
  resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import { resolveRecommendedQuestionsHomeIntent } from '@/features/home/thread/homeIntentContract';
import {
  InstantRecommendedQuestionsInput,
  isRecommendationQuestionsFinalized,
  RecommendQuestionResultStatus,
  Task,
  ThreadRecommendQuestionResult,
} from './askingServiceShared';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  summarizePreviewData,
  type RecommendationPreviewColumn,
} from './recommendationIntelligence';
import type { PreviewDataResponse } from './queryService';

const DEFAULT_RECOMMENDATION_FOLLOW_UP_QUESTION = '推荐几个问题给我';
const RECOMMENDATION_SOURCE_ANSWER_MAX_LENGTH = 1_500;

interface AskingRecommendationServiceLike {
  generateThreadRecommendationQuestions(
    threadId: number,
    runtimeScopeId?: string | null,
  ): Promise<void>;
  threadRepository: Pick<any, 'findOneBy' | 'updateOne'>;
  createThreadResponse(
    input: {
      question?: string;
      recommendationDetail?: any;
      responseKind?: string | null;
      sourceResponseId?: number | null;
    },
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<any>;
  getResponse(responseId: number): Promise<any>;
  getThreadResponseRuntimeIdentity(
    response: any,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ): Promise<PersistedRuntimeIdentity>;
  getAskingHistory(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    excludeThreadResponseId?: number,
  ): Promise<any[]>;
  previewDataScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    limit?: number,
  ): Promise<PreviewDataResponse>;
  threadResponseRepository: Pick<any, 'findAllBy' | 'updateOne'>;
  threadRecommendQuestionBackgroundTracker: Pick<any, 'isExist' | 'addTask'>;
  threadResponseRecommendQuestionBackgroundTracker: Pick<
    any,
    'isExist' | 'addTask'
  >;
  wrenAIAdaptor: Pick<
    any,
    'generateRecommendationQuestions' | 'getRecommendationQuestionsResult'
  >;
  instantRecommendedQuestionTasks: Map<string, any>;
  getExecutionResources(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<any>;
  toAskRuntimeIdentity(runtimeIdentity?: PersistedRuntimeIdentity | null): any;
  getThreadRecommendationQuestionsConfig(project: any): any;
  isLikelyNonChineseQuestions(questions: any[] | undefined | null): boolean;
  shouldForceChineseThreadRecommendation(thread: any): Promise<boolean>;
  trackInstantRecommendedQuestionTask(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): void;
  assertInstantRecommendedQuestionTaskScope(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): void;
}

const truncateText = (value?: string | null, maxLength = 1000) => {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
};

const resolveRecommendationQuestionLanguage = (language?: string | null) => {
  switch ((language || '').trim().toLowerCase()) {
    case 'en':
    case 'english':
      return WrenAILanguage.EN;
    case 'zh':
    case 'zh-cn':
    case 'zh_hans':
    case 'simplified chinese':
      return WrenAILanguage.ZH_CN;
    case 'zh-tw':
    case 'zh_hant':
    case 'traditional chinese':
      return WrenAILanguage.ZH_TW;
    default:
      return undefined;
  }
};

const resolveChartEncodingSummary = (
  chartSchema?: Record<string, any> | null,
) => {
  const encoding =
    chartSchema &&
    typeof chartSchema === 'object' &&
    chartSchema.encoding &&
    typeof chartSchema.encoding === 'object'
      ? (chartSchema.encoding as Record<
          string,
          { field?: string; title?: string }
        >)
      : null;

  if (!encoding) {
    return [];
  }

  return Object.entries(encoding)
    .map(([channel, config]) => {
      const field = config?.title || config?.field;
      return field ? `${channel}: ${field}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 6);
};

const resolveResponseLineageIntent = (response: any) => {
  if (response?.responseKind === 'RECOMMENDATION_FOLLOWUP') {
    return 'RECOMMEND_QUESTIONS';
  }

  if (
    response?.chartDetail?.status === 'FINISHED' &&
    response?.chartDetail?.chartSchema
  ) {
    return 'CHART';
  }

  if (response?.sql) {
    return 'ASK';
  }

  return null;
};

const buildRecommendationPromptContext = ({
  question,
  sourceResponse,
  sourceIntentLineage,
  sourcePreview,
}: {
  question?: string | null;
  sourceResponse: any;
  sourceIntentLineage?: string[];
  sourcePreview?: {
    previewColumnCount?: number;
    previewColumns: RecommendationPreviewColumn[];
    previewRowCount?: number;
  } | null;
}) => {
  const previewColumns = (sourcePreview?.previewColumns || []).slice(0, 8);
  const dimensionColumns = previewColumns
    .filter((column) => column.role === 'dimension')
    .map((column) => column.name)
    .slice(0, 6);
  const measureColumns = previewColumns
    .filter((column) => column.role === 'measure')
    .map((column) => column.name)
    .slice(0, 6);
  const chartSchema =
    sourceResponse.chartDetail?.rawChartSchema ||
    sourceResponse.chartDetail?.chartSchema ||
    null;

  return {
    userQuestion: question || undefined,
    sourceQuestion:
      sourceResponse.askingTask?.rephrasedQuestion ||
      sourceResponse.question ||
      undefined,
    sourceAnswer: truncateText(
      sourceResponse.answerDetail?.content,
      RECOMMENDATION_SOURCE_ANSWER_MAX_LENGTH,
    ),
    sourceSql: truncateText(sourceResponse.sql, 1_500),
    sourceChartType: sourceResponse.chartDetail?.chartType || null,
    sourceChartTitle:
      typeof chartSchema?.title === 'string' ? chartSchema.title : null,
    sourceChartEncodings: resolveChartEncodingSummary(chartSchema),
    sourceDimensionColumns: dimensionColumns,
    sourceIntentLineage: sourceIntentLineage?.slice(0, 3) || [],
    sourceMeasureColumns: measureColumns,
    sourcePreviewColumnCount: sourcePreview?.previewColumnCount,
    sourcePreviewColumns:
      previewColumns.length > 0 ? previewColumns : undefined,
    sourcePreviewRowCount: sourcePreview?.previewRowCount,
    sourceResponseKind: sourceResponse.responseKind || null,
  };
};

const isGenericRecommendationTrigger = (question?: string | null) =>
  !question ||
  /推荐几个问题给我|推荐.*问题|suggest.*question|recommend.*question/i.test(
    question,
  );

export const getThreadRecommendationQuestionsAction = async (
  service: AskingRecommendationServiceLike,
  threadId: number,
): Promise<ThreadRecommendQuestionResult> => {
  const thread = await service.threadRepository.findOneBy({ id: threadId });
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  const threadResponses = await service.threadResponseRepository.findAllBy({
    threadId,
  });
  const latestThreadResponse =
    [...(threadResponses || [])]
      .sort((left: any, right: any) => (right.id || 0) - (left.id || 0))
      .at(0) || null;
  const res: ThreadRecommendQuestionResult = {
    status: RecommendQuestionResultStatus.NOT_STARTED,
    questions: [],
    error: undefined,
    resolvedIntent: resolveRecommendedQuestionsHomeIntent({
      source: 'derived',
      sourceThreadId: thread.id,
      sourceResponseId: latestThreadResponse?.id ?? null,
    }),
  };
  if (thread.queryId && thread.questionsStatus) {
    const mappedStatus =
      thread.questionsStatus as keyof typeof RecommendQuestionResultStatus;
    res.status = RecommendQuestionResultStatus[mappedStatus] || res.status;
    res.questions = thread.questions || [];
    res.error = thread.questionsError || undefined;

    const shouldRegenerateInChinese =
      res.status === RecommendQuestionResultStatus.FINISHED &&
      service.isLikelyNonChineseQuestions(res.questions) &&
      (await service.shouldForceChineseThreadRecommendation(thread));

    if (shouldRegenerateInChinese) {
      await service.generateThreadRecommendationQuestions(threadId);
      return {
        status: RecommendQuestionResultStatus.GENERATING,
        questions: [],
        error: undefined,
        resolvedIntent: res.resolvedIntent,
      };
    }
  }
  return res;
};

export const generateThreadRecommendationQuestionsAction = async (
  service: AskingRecommendationServiceLike,
  threadId: number,
  runtimeScopeId?: string | null,
): Promise<void> => {
  const thread = await service.threadRepository.findOneBy({ id: threadId });
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  if (service.threadRecommendQuestionBackgroundTracker.isExist(thread)) {
    return;
  }

  const runtimeIdentity = toPersistedRuntimeIdentityFromSource(thread);
  const { project, manifest } =
    await service.getExecutionResources(runtimeIdentity);
  const threadResponses = await service.threadResponseRepository.findAllBy({
    threadId,
  });
  const slicedThreadResponses = threadResponses
    .sort((a: any, b: any) => b.id - a.id)
    .slice(0, 5);
  const questions = slicedThreadResponses.map(({ question }: any) => question);
  const recommendQuestionRuntimeIdentity =
    normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);
  const recommendQuestionData = {
    manifest,
    runtimeScopeId:
      runtimeScopeId ||
      resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
        recommendQuestionRuntimeIdentity,
      ) ||
      undefined,
    runtimeIdentity: service.toAskRuntimeIdentity(
      recommendQuestionRuntimeIdentity,
    ),
    previousQuestions: questions,
    ...service.getThreadRecommendationQuestionsConfig(project),
  };

  const result = await service.wrenAIAdaptor.generateRecommendationQuestions(
    recommendQuestionData,
  );
  const updatedThread = await service.threadRepository.updateOne(threadId, {
    queryId: result.queryId,
    questionsStatus: RecommendationQuestionStatus.GENERATING,
    questions: [],
    questionsError: undefined,
  });
  service.threadRecommendQuestionBackgroundTracker.addTask(updatedThread);
};

export const createInstantRecommendedQuestionsAction = async (
  service: AskingRecommendationServiceLike,
  input: InstantRecommendedQuestionsInput,
  runtimeIdentity: PersistedRuntimeIdentity,
  runtimeScopeId?: string | null,
): Promise<Task> => {
  const { project, manifest } =
    await service.getExecutionResources(runtimeIdentity);
  const recommendQuestionRuntimeIdentity =
    normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);
  const response = await service.wrenAIAdaptor.generateRecommendationQuestions({
    manifest,
    runtimeScopeId: runtimeScopeId || undefined,
    runtimeIdentity: service.toAskRuntimeIdentity(
      recommendQuestionRuntimeIdentity,
    ),
    previousQuestions: input.previousQuestions,
    ...service.getThreadRecommendationQuestionsConfig(project),
  });
  service.trackInstantRecommendedQuestionTask(
    response.queryId,
    runtimeIdentity,
  );
  return { id: response.queryId };
};

export const generateThreadResponseRecommendationsAction = async (
  service: AskingRecommendationServiceLike,
  responseId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
  configurations: { language: string; question?: string | null },
  runtimeScopeId?: string | null,
) => {
  const triggerResponse = await service.getResponse(responseId);
  if (!triggerResponse) {
    throw new Error(`Thread response ${responseId} not found`);
  }

  const recommendationResponse =
    triggerResponse.responseKind === 'RECOMMENDATION_FOLLOWUP'
      ? triggerResponse
      : null;
  const sourceResponseId =
    recommendationResponse?.recommendationDetail?.sourceResponseId ??
    recommendationResponse?.sourceResponseId ??
    triggerResponse.id;
  const sourceResponse =
    recommendationResponse && sourceResponseId !== triggerResponse.id
      ? await service.getResponse(sourceResponseId)
      : triggerResponse;

  if (!sourceResponse) {
    throw new Error(`Source thread response ${sourceResponseId} not found`);
  }

  const recommendationRuntimeIdentity =
    await service.getThreadResponseRuntimeIdentity(
      sourceResponse,
      runtimeIdentity,
    );
  const { project, manifest } = await service.getExecutionResources(
    recommendationRuntimeIdentity,
  );
  const recommendQuestionRuntimeIdentity =
    normalizeCanonicalPersistedRuntimeIdentity(recommendationRuntimeIdentity);
  const askHistory = await service.getAskingHistory(
    sourceResponse.threadId,
    recommendationRuntimeIdentity,
    recommendationResponse?.id ?? undefined,
  );
  const sourceIntentLineage = [...askHistory, sourceResponse]
    .map(resolveResponseLineageIntent)
    .filter((intent): intent is 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' =>
      Boolean(intent),
    )
    .slice(-3);
  const previousQuestions = askHistory
    .slice(-5)
    .map((response: any) => response.question)
    .filter((question: string | undefined) => Boolean(question));
  const sourcePreview = sourceResponse.sql
    ? summarizePreviewData(
        await service
          .previewDataScoped(
            sourceResponse.id,
            recommendationRuntimeIdentity,
            20,
          )
          .catch(() => null),
      )
    : null;
  const promptContext = buildRecommendationPromptContext({
    question: isGenericRecommendationTrigger(configurations.question)
      ? undefined
      : configurations.question,
    sourceResponse,
    sourceIntentLineage,
    sourcePreview,
  });
  const languageConfig = resolveRecommendationQuestionLanguage(
    configurations.language,
  );

  const initialRecommendationDetail = {
    status: RecommendationQuestionStatus.GENERATING,
    items: [],
    error: undefined,
    queryId: null,
    sourceResponseId: sourceResponse.id,
  };

  if (
    recommendationResponse &&
    (service.threadResponseRecommendQuestionBackgroundTracker.isExist(
      recommendationResponse,
    ) ||
      recommendationResponse.recommendationDetail?.status ===
        RecommendationQuestionStatus.GENERATING)
  ) {
    return recommendationResponse;
  }

  const targetResponse = recommendationResponse
    ? await service.threadResponseRepository.updateOne(
        recommendationResponse.id,
        {
          recommendationDetail: initialRecommendationDetail,
        },
      )
    : await service.createThreadResponse(
        {
          question:
            configurations.question ||
            DEFAULT_RECOMMENDATION_FOLLOW_UP_QUESTION,
          responseKind: 'RECOMMENDATION_FOLLOWUP',
          sourceResponseId: sourceResponse.id,
          recommendationDetail: initialRecommendationDetail,
        },
        sourceResponse.threadId,
        recommendationRuntimeIdentity,
      );

  const result = await service.wrenAIAdaptor.generateRecommendationQuestions({
    manifest,
    runtimeScopeId:
      runtimeScopeId ||
      resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
        recommendQuestionRuntimeIdentity,
      ) ||
      undefined,
    runtimeIdentity: service.toAskRuntimeIdentity(
      recommendQuestionRuntimeIdentity,
    ),
    previousQuestions,
    ...promptContext,
    ...service.getThreadRecommendationQuestionsConfig({
      ...project,
      language: languageConfig || project.language,
    }),
  });

  const updatedResponse = await service.threadResponseRepository.updateOne(
    targetResponse.id,
    {
      recommendationDetail: {
        ...initialRecommendationDetail,
        queryId: result.queryId,
      },
    },
  );

  service.threadResponseRecommendQuestionBackgroundTracker.addTask(
    updatedResponse,
  );

  return updatedResponse;
};

export const getInstantRecommendedQuestionsAction = async (
  service: AskingRecommendationServiceLike,
  queryId: string,
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  service.assertInstantRecommendedQuestionTaskScope(queryId, runtimeIdentity);
  const response =
    await service.wrenAIAdaptor.getRecommendationQuestionsResult(queryId);
  if (isRecommendationQuestionsFinalized(response.status)) {
    service.instantRecommendedQuestionTasks.delete(queryId);
  }
  return response;
};
