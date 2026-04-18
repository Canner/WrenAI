import type { SqlPair } from './knowledge';
import type { ViewInfo } from './modeling';

export type Error = {
  code?: string | null;
  message?: string | null;
  shortMessage?: string | null;
  stacktrace?: Array<string | null> | null;
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
  sql?: string | null;
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
  chartDataProfile?: any;
  chartSchema?: any;
  chartType?: ChartType | null;
  description?: string | null;
  error?: Error | null;
  queryId?: string | null;
  rawChartSchema?: any;
  renderHints?: any;
  status: ChartTaskStatus;
  validationErrors?: string[] | null;
};

export type ThreadResponse = {
  adjustment?: ThreadResponseAdjustment | null;
  adjustmentTask?: AdjustmentTask | null;
  answerDetail?: ThreadResponseAnswerDetail | null;
  askingTask?: AskingTask | null;
  breakdownDetail?: ThreadResponseBreakdownDetail | null;
  chartDetail?: ThreadResponseChartDetail | null;
  id: number;
  question: string;
  sql?: string | null;
  threadId: number;
  view?: ViewInfo | null;
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
