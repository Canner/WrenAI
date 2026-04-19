import { cloneDeep, uniq } from 'lodash';
import {
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import {
  AdjustmentTask,
  AskingTask,
  AskingTaskStatus,
  AskingTaskType,
  RecommendedQuestionsTask,
  RecommendedQuestionsTaskStatus,
} from '@/types/home';
import type { UpdateThreadDetailState } from './useThreadDetail';

export interface AskPromptData {
  originalQuestion: string;
  askingTask?: AskingTask | null;
  askingStreamTask?: string;
  recommendedQuestions?: RecommendedQuestionsTask | null;
}

export interface AskPromptSubmitDefaults {
  knowledgeBaseIds?: string[];
  selectedSkillIds?: string[];
}

export type NullableAskingTask = AskingTask | null | undefined;

export const ASKING_TASK_POLL_INTERVAL_MS = 1500;
export const ASKING_TASK_POLL_TIMEOUT_MS = 45_000;
export const INSTANT_RECOMMEND_POLL_INTERVAL_MS = 1500;
export const INSTANT_RECOMMEND_POLL_TIMEOUT_MS = 20_000;

export const getIsFinished = (status?: AskingTaskStatus | null) =>
  status != null &&
  [
    AskingTaskStatus.FINISHED,
    AskingTaskStatus.FAILED,
    AskingTaskStatus.STOPPED,
  ].includes(status);

export const canGenerateAnswer = (
  askingTask: NullableAskingTask,
  adjustmentTask?: AdjustmentTask | null,
) =>
  (askingTask === null && adjustmentTask === null) ||
  (askingTask?.status === AskingTaskStatus.FINISHED &&
    askingTask?.type === AskingTaskType.TEXT_TO_SQL) ||
  adjustmentTask?.status === AskingTaskStatus.FINISHED;

export const canFetchThreadResponse = (askingTask: NullableAskingTask) =>
  askingTask !== null &&
  askingTask?.status !== AskingTaskStatus.FAILED &&
  askingTask?.status !== AskingTaskStatus.STOPPED;

export const isReadyToThreadResponse = (askingTask: NullableAskingTask) =>
  askingTask?.status === AskingTaskStatus.SEARCHING &&
  askingTask?.type === AskingTaskType.TEXT_TO_SQL;

export const isRecommendedFinished = (
  status?: RecommendedQuestionsTaskStatus | null,
) =>
  status != null &&
  [
    RecommendedQuestionsTaskStatus.FINISHED,
    RecommendedQuestionsTaskStatus.FAILED,
    RecommendedQuestionsTaskStatus.NOT_STARTED,
  ].includes(status);

export const isNeedRecommendedQuestions = (askingTask: NullableAskingTask) => {
  const isGeneralOrMisleadingQuery =
    askingTask?.type === AskingTaskType.GENERAL ||
    askingTask?.type === AskingTaskType.MISLEADING_QUERY;
  const isFailed =
    askingTask?.type !== AskingTaskType.TEXT_TO_SQL &&
    askingTask?.status === AskingTaskStatus.FAILED;
  return isGeneralOrMisleadingQuery || isFailed;
};

export const isNeedPreparing = (askingTask: NullableAskingTask) =>
  askingTask?.type === AskingTaskType.TEXT_TO_SQL;

export const buildRecommendedQuestionHistory = (
  threadQuestions: string[],
  originalQuestion: string,
) =>
  Array.from(
    new Set(
      [...uniq(threadQuestions).slice(-5), originalQuestion].filter(Boolean),
    ),
  );

export const handleUpdateThreadCache = (
  askingTask: NullableAskingTask,
  updateThreadQuery?: UpdateThreadDetailState,
) => {
  if (!askingTask || !updateThreadQuery) {
    return;
  }

  updateThreadQuery((existingData) => {
    if (!existingData?.thread) {
      return existingData;
    }

    return {
      thread: {
        ...existingData.thread,
        responses: existingData.thread.responses.map((response) => {
          if (response.askingTask?.queryId === askingTask.queryId) {
            return {
              ...response,
              askingTask: cloneDeep(askingTask),
            };
          }
          return response;
        }),
      },
    };
  });
};

export const handleUpdateRerunAskingTaskCache = ({
  threadResponseId,
  askingTask,
  updateThreadQuery,
}: {
  threadResponseId: number;
  askingTask: NullableAskingTask;
  updateThreadQuery?: UpdateThreadDetailState;
}) => {
  if (!askingTask || !updateThreadQuery) {
    return;
  }

  const task = cloneDeep(askingTask);
  if (task.status === AskingTaskStatus.UNDERSTANDING) {
    task.status = AskingTaskStatus.SEARCHING;
    task.type = AskingTaskType.TEXT_TO_SQL;
  }

  updateThreadQuery((existingData) => {
    if (!existingData?.thread) {
      return existingData;
    }

    return {
      thread: {
        ...existingData.thread,
        responses: existingData.thread.responses.map((response) => {
          if (response.id === threadResponseId) {
            return { ...response, askingTask: task };
          }
          return response;
        }),
      },
    };
  });
};

export const resolveRuntimeScopeSelector = (
  selector?: ClientRuntimeScopeSelector,
) => selector || resolveClientRuntimeScopeSelector();
