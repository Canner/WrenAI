import type { SqlPair } from './knowledge';
import type { ViewInfo } from './modeling';
import type { ResolvedHomeIntent, ResponseArtifactLineage } from './homeIntent';

export type Error = {
  code?: string | null;
  message?: string | null;
  shortMessage?: string | null;
  stacktrace?: Array<string | null> | null;
};

export type ThinkingMessageParam = string | number | boolean | null;

export type ThinkingStepStatus =
  | 'pending'
  | 'running'
  | 'finished'
  | 'failed'
  | 'skipped';

export type ThinkingStep = {
  detail?: string | null;
  durationMs?: number | null;
  errorCode?: string | null;
  finishedAt?: string | null;
  key: string;
  messageKey: string;
  messageParams?: Record<string, ThinkingMessageParam> | null;
  phase?: string | null;
  startedAt?: string | null;
  status: ThinkingStepStatus;
  tags?: string[] | null;
};

export type ThinkingTrace = {
  currentStepKey?: string | null;
  steps: ThinkingStep[];
};

export enum AskingTaskStatus {
  CORRECTING = 'CORRECTING',
  FAILED = 'FAILED',
  FINISHED = 'FINISHED',
  GENERATING = 'GENERATING',
  PLANNING = 'PLANNING',
  SEARCHING = 'SEARCHING',
  STOPPED = 'STOPPED',
  UNDERSTANDING = 'UNDERSTANDING',
}

export enum AskingTaskType {
  GENERAL = 'GENERAL',
  MISLEADING_QUERY = 'MISLEADING_QUERY',
  TEXT_TO_SQL = 'TEXT_TO_SQL',
}

export enum CacheScheduleDayEnum {
  FRI = 'FRI',
  MON = 'MON',
  SAT = 'SAT',
  SUN = 'SUN',
  THU = 'THU',
  TUE = 'TUE',
  WED = 'WED',
}

export enum ChartTaskStatus {
  FAILED = 'FAILED',
  FETCHING = 'FETCHING',
  FINISHED = 'FINISHED',
  GENERATING = 'GENERATING',
  STOPPED = 'STOPPED',
}

export enum ThreadResponseKind {
  ANSWER = 'ANSWER',
  CHART_FOLLOWUP = 'CHART_FOLLOWUP',
  RECOMMENDATION_FOLLOWUP = 'RECOMMENDATION_FOLLOWUP',
}

export enum ChartType {
  AREA = 'AREA',
  BAR = 'BAR',
  GROUPED_BAR = 'GROUPED_BAR',
  LINE = 'LINE',
  MULTI_LINE = 'MULTI_LINE',
  PIE = 'PIE',
  STACKED_BAR = 'STACKED_BAR',
}

export enum DashboardItemType {
  AREA = 'AREA',
  BAR = 'BAR',
  GROUPED_BAR = 'GROUPED_BAR',
  LINE = 'LINE',
  PIE = 'PIE',
  STACKED_BAR = 'STACKED_BAR',
  TABLE = 'TABLE',
  NUMBER = 'NUMBER',
}

export type AdjustThreadResponseChartInput = {
  chartType: ChartType;
  color?: string | null;
  theta?: string | null;
  xAxis?: string | null;
  xOffset?: string | null;
  yAxis?: string | null;
};

export type ResultQuestion = {
  category: string;
  question: string;
  sql: string;
};

export type SuggestedQuestion = {
  label: string;
  question: string;
};

export type SuggestedQuestionResponse = {
  questions: Array<SuggestedQuestion | null>;
};

export type ThreadResponseRecommendationCategory =
  | 'drill_down'
  | 'compare'
  | 'trend'
  | 'distribution'
  | 'ranking'
  | 'chart_followup'
  | 'chart_refine'
  | 'related_question';

export type ThreadResponseRecommendationItem = {
  category?: ThreadResponseRecommendationCategory | null;
  interactionMode?: 'draft_to_composer' | 'execute_intent' | null;
  label: string;
  prompt: string;
  sql?: string | null;
  suggestedIntent?: 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' | null;
};

export type ThreadResponseRecommendationDetail = {
  error?: Error | null;
  items: ThreadResponseRecommendationItem[];
  queryId?: string | null;
  sourceResponseId?: number | null;
  status: RecommendedQuestionsTaskStatus;
};

export enum ResultCandidateType {
  LLM = 'LLM',
  SQL_PAIR = 'SQL_PAIR',
  VIEW = 'VIEW',
}

export type ResultCandidate = {
  sql: string;
  sqlPair?: SqlPair | null;
  type: ResultCandidateType;
  view?: ViewInfo | null;
};

export type AskingTask = {
  candidates: ResultCandidate[];
  error?: Error | null;
  intentReasoning?: string | null;
  invalidSql?: string | null;
  queryId?: string | null;
  rephrasedQuestion?: string | null;
  retrievedTables?: string[] | null;
  sqlGenerationReasoning?: string | null;
  status: AskingTaskStatus;
  thinking?: ThinkingTrace | null;
  traceId?: string | null;
  type?: AskingTaskType | null;
};

export type AskingTaskInput = {
  knowledgeBaseIds?: string[] | null;
  question: string;
  selectedSkillIds?: string[] | null;
  threadId?: number | null;
};

export type AdjustmentTask = {
  error?: Error | null;
  invalidSql?: string | null;
  queryId?: string | null;
  sql?: string | null;
  status?: AskingTaskStatus | null;
  traceId?: string | null;
};

export enum RecommendedQuestionsTaskStatus {
  FAILED = 'FAILED',
  FINISHED = 'FINISHED',
  GENERATING = 'GENERATING',
  NOT_STARTED = 'NOT_STARTED',
}

export type RecommendedQuestionsTask = {
  error?: Error | null;
  questions: ResultQuestion[];
  resolvedIntent?: ResolvedHomeIntent | null;
  status: RecommendedQuestionsTaskStatus;
};

export type Task = {
  id: string;
};

export type CreateThreadInput = {
  knowledgeBaseIds?: string[] | null;
  question?: string | null;
  selectedSkillIds?: string[] | null;
  sql?: string | null;
  taskId?: string | null;
};

export type CreateThreadResponseInput = {
  question?: string | null;
  responseKind?: ThreadResponseKind | null;
  sql?: string | null;
  sourceResponseId?: number | null;
  taskId?: string | null;
};

export type CreateDashboardItemInput = {
  dashboardId?: number | null;
  itemType: string;
  responseId: number;
};

export type DetailStep = {
  cteName?: string | null;
  sql: string;
  summary: string;
};

export type Thread = {
  deployHash?: string | null;
  id: number;
  kbSnapshotId?: string | null;
  knowledgeBaseId?: string | null;
  knowledgeBaseIds: string[];
  selectedSkillIds: string[];
  summary: string;
  workspaceId?: string | null;
};

export type ThreadResponseAdjustment = {
  payload?: any;
  type: ThreadResponseAdjustmentType;
};

export enum ThreadResponseAdjustmentType {
  APPLY_SQL = 'APPLY_SQL',
  REASONING = 'REASONING',
}

export type ThreadResponseAnswerDetail = {
  content?: string | null;
  error?: Error | null;
  instructionCount?: number | null;
  numRowsUsedInLLM?: number | null;
  queryId?: string | null;
  status?: ThreadResponseAnswerStatus | null;
};

export enum ThreadResponseAnswerStatus {
  FAILED = 'FAILED',
  FETCHING_DATA = 'FETCHING_DATA',
  FINISHED = 'FINISHED',
  INTERRUPTED = 'INTERRUPTED',
  NOT_STARTED = 'NOT_STARTED',
  PREPROCESSING = 'PREPROCESSING',
  STREAMING = 'STREAMING',
}

export type ThreadResponseBreakdownDetail = {
  description?: string | null;
  error?: Error | null;
  queryId?: string | null;
  status: AskingTaskStatus;
  steps?: DetailStep[] | null;
};

export type ThreadResponseChartDetail = {
  adjustment?: boolean | null;
  canonicalizationVersion?: string | null;
  chartability?: {
    chartable: boolean;
    reasonCode?: string | null;
    message?: string | null;
  } | null;
  chartDataProfile?: any;
  chartSchema?: any;
  chartType?: ChartType | null;
  description?: string | null;
  diagnostics?: {
    previewColumnCount?: number | null;
    previewRowCount?: number | null;
    previewColumns?: Array<{
      name: string;
      type?: string | null;
    }> | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    submittedAt?: string | null;
    finalizedAt?: string | null;
  } | null;
  error?: Error | null;
  queryId?: string | null;
  rawChartSchema?: any;
  renderHints?: any;
  status: ChartTaskStatus;
  thinking?: ThinkingTrace | null;
  validationErrors?: string[] | null;
};

export type ThreadResponse = {
  adjustment?: ThreadResponseAdjustment | null;
  adjustmentTask?: AdjustmentTask | null;
  answerDetail?: ThreadResponseAnswerDetail | null;
  artifactLineage?: ResponseArtifactLineage | null;
  askingTask?: AskingTask | null;
  breakdownDetail?: ThreadResponseBreakdownDetail | null;
  chartDetail?: ThreadResponseChartDetail | null;
  id: number;
  deployHash?: string | null;
  kbSnapshotId?: string | null;
  knowledgeBaseId?: string | null;
  question: string;
  recommendationDetail?: ThreadResponseRecommendationDetail | null;
  resolvedIntent?: ResolvedHomeIntent | null;
  responseKind?: ThreadResponseKind | null;
  sql?: string | null;
  sourceResponseId?: number | null;
  threadId: number;
  view?: ViewInfo | null;
  workspaceId?: string | null;
};

export type DetailedThread = {
  deployHash?: string | null;
  id: number;
  kbSnapshotId?: string | null;
  knowledgeBaseId?: string | null;
  knowledgeBaseIds: string[];
  responses: ThreadResponse[];
  selectedSkillIds: string[];
  summary?: string | null;
  workspaceId?: string | null;
};

export type SuggestedQuestionsResponse = {
  suggestedQuestions: SuggestedQuestionResponse;
};

export type PreviewDataResponse = {
  previewData: any;
};

export type InstantRecommendedQuestionsResponse = {
  instantRecommendedQuestions: RecommendedQuestionsTask;
};

export type ProjectRecommendationQuestionsResponse = {
  getProjectRecommendationQuestions: RecommendedQuestionsTask;
};
