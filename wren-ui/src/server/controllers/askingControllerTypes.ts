import {
  WrenAIError,
  AskResultStatus,
  AskResultType,
  RecommendationQuestionStatus,
  AskFeedbackStatus,
} from '@server/models/adaptor';
import { ThreadResponse } from '../repositories/threadResponseRepository';
import { SuggestedQuestion } from '../data';

export interface SuggestedQuestionResponse {
  questions: SuggestedQuestion[];
}

export interface Task {
  id: string;
}

export interface AdjustmentTask {
  queryId: string;
  status: AskFeedbackStatus;
  error: WrenAIError | null;
  sql: string;
  traceId: string;
  invalidSql?: string;
}

export interface AskingTask {
  type: AskResultType | null;
  status: AskResultStatus;
  candidates: Array<{
    sql: string;
    type?: unknown;
    view?: unknown;
    sqlPair?: unknown;
  }>;
  error: WrenAIError | null;
  rephrasedQuestion?: string;
  intentReasoning?: string;
  sqlGenerationReasoning?: string;
  retrievedTables?: string[];
  invalidSql?: string;
  traceId?: string;
  queryId?: string;
}

export interface DetailedThread {
  id: number;
  sql: string;
  summary?: string;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  knowledgeBaseIds?: string[] | null;
  selectedSkillIds?: string[] | null;
  responses: ThreadResponse[];
}

export interface RecommendedQuestionsTask {
  questions: {
    question: string;
    category: string;
    sql: string;
  }[];
  status: RecommendationQuestionStatus;
  error: WrenAIError | null;
}
