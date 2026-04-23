import { isEmpty } from 'lodash';
import {
  AskingTaskStatus,
  AskingTaskType,
  ThreadResponseKind,
} from '@/types/home';
import type { AskingTask, DetailedThread, ThreadResponse } from '@/types/home';
import { getIsFinished } from '@/hooks/useAskPrompt';
import { getAnswerIsFinished } from '@/components/pages/home/promptThread/answerGeneration';
import { getIsChartFinished } from '@/components/pages/home/promptThread/ChartAnswer';

export type ThreadData = DetailedThread;
export type ThreadResponseData = ThreadData['responses'][number];

export const getThreadResponseIsFinished = (
  threadResponse?: ThreadResponseData | null,
) => {
  const { answerDetail, breakdownDetail, chartDetail } = threadResponse || {};
  const hasSqlResult =
    typeof threadResponse?.sql === 'string' && threadResponse.sql.trim() !== '';
  const hasAnswerTask = Boolean(answerDetail?.queryId || answerDetail?.status);
  const hasChartTask = Boolean(chartDetail?.queryId || chartDetail?.status);

  const isBreakdownOnly = answerDetail === null && !isEmpty(breakdownDetail);

  if (hasSqlResult && !hasAnswerTask && !hasChartTask) {
    return true;
  }

  let isAnswerFinished = isBreakdownOnly ? null : false;
  let isChartFinished = null;

  if (hasAnswerTask) {
    isAnswerFinished = getAnswerIsFinished(answerDetail?.status);
  }

  if (hasChartTask) {
    isChartFinished = getIsChartFinished(chartDetail?.status);
  }

  return isAnswerFinished !== false && isChartFinished !== false;
};

export const hasReferenceRenderableResponse = (
  threadResponse: ThreadResponseData | null,
) =>
  Boolean(
    threadResponse?.answerDetail?.content ||
    threadResponse?.chartDetail?.chartSchema ||
    threadResponse?.sql,
  );

export const buildThreadQuestionSignature = (
  responses: ThreadResponseData[],
) => {
  const latestResponse = responses[responses.length - 1];
  const latestQuestion = latestResponse?.question || '';

  return `${responses.length}:${latestResponse?.id || 'none'}:${latestQuestion}`;
};

export const findLatestUnfinishedAskingResponse = (
  responses: ThreadResponseData[],
) =>
  [...(responses || [])]
    .reverse()
    .find(
      (response) =>
        response?.askingTask && !getIsFinished(response?.askingTask?.status),
    );

export const findLatestPollableThreadResponse = (
  responses: ThreadResponseData[],
) =>
  [...(responses || [])]
    .reverse()
    .find((response) => !getThreadResponseIsFinished(response));

export const hasActivePromptAskingTask = (askingTask?: AskingTask | null) =>
  Boolean(askingTask?.queryId && !getIsFinished(askingTask?.status));

export const shouldSuspendThreadRecoveryDuringPromptFlow = ({
  askingTask,
  loading,
}: {
  askingTask?: AskingTask | null;
  loading?: boolean;
}) => Boolean(loading || hasActivePromptAskingTask(askingTask));

export type ThreadRecoveryPlan =
  | {
      type: 'suspend';
      taskId: string | null;
    }
  | {
      type: 'resumeAskingTask';
      taskId: string;
    }
  | {
      type: 'resumeThreadResponse';
      responseId: number;
    }
  | {
      type: 'clear';
    }
  | {
      type: 'noop';
    };

export const resolveThreadRecoveryPlan = ({
  responses,
  askingTask,
  loading,
  currentPollingTaskId,
  currentPollingResponseId,
}: {
  responses: ThreadResponseData[];
  askingTask?: AskingTask | null;
  loading?: boolean;
  currentPollingTaskId?: string | null;
  currentPollingResponseId?: number | null;
}): ThreadRecoveryPlan => {
  if (
    shouldSuspendThreadRecoveryDuringPromptFlow({
      askingTask,
      loading,
    })
  ) {
    return {
      type: 'suspend',
      taskId: askingTask?.queryId || null,
    };
  }

  const unfinishedAskingResponse =
    findLatestUnfinishedAskingResponse(responses);
  if (unfinishedAskingResponse) {
    const taskId = unfinishedAskingResponse.askingTask?.queryId;
    if (!taskId || currentPollingTaskId === taskId) {
      return { type: 'noop' };
    }

    return {
      type: 'resumeAskingTask',
      taskId,
    };
  }

  const unfinishedThreadResponse = findLatestPollableThreadResponse(responses);
  if (unfinishedThreadResponse) {
    if (currentPollingResponseId === unfinishedThreadResponse.id) {
      return { type: 'noop' };
    }

    return {
      type: 'resumeThreadResponse',
      responseId: unfinishedThreadResponse.id,
    };
  }

  return { type: 'clear' };
};

export const buildPendingPromptThreadResponse = ({
  thread,
  originalQuestion,
  askingTask,
  loading,
}: {
  thread?: ThreadData | null;
  originalQuestion?: string | null;
  askingTask?: AskingTask | null;
  loading?: boolean;
}): ThreadResponseData | null => {
  if (!thread) {
    return null;
  }

  const question = originalQuestion?.trim();
  if (!question) {
    return null;
  }

  if (
    !shouldSuspendThreadRecoveryDuringPromptFlow({
      askingTask,
      loading,
    })
  ) {
    return null;
  }

  const hasPersistedResponse = thread.responses.some((response) => {
    if (
      askingTask?.queryId &&
      response.askingTask?.queryId === askingTask.queryId
    ) {
      return true;
    }

    return false;
  });

  if (hasPersistedResponse) {
    return null;
  }

  return {
    id:
      Math.min(
        0,
        ...thread.responses.map((response) =>
          typeof response.id === 'number' ? response.id : 0,
        ),
      ) - 1,
    threadId: thread.id,
    question,
    responseKind: ThreadResponseKind.ANSWER,
    sql: null,
    sourceResponseId: null,
    view: null,
    askingTask: askingTask || {
      candidates: [],
      queryId: null,
      status: AskingTaskStatus.UNDERSTANDING,
      type: AskingTaskType.TEXT_TO_SQL,
    },
    breakdownDetail: null,
    answerDetail: null,
    chartDetail: null,
    adjustment: null,
    adjustmentTask: null,
  };
};

const buildPendingFollowUpAskingTask = ({
  taskId,
  fallbackAskingTask,
}: {
  taskId?: string;
  fallbackAskingTask?: AskingTask | null;
}): AskingTask | null => {
  if (!taskId) {
    return null;
  }

  if (fallbackAskingTask?.queryId === taskId) {
    return {
      ...fallbackAskingTask,
      candidates: [...(fallbackAskingTask.candidates || [])],
    };
  }

  return {
    candidates: [],
    queryId: taskId,
    status: AskingTaskStatus.SEARCHING,
    type: AskingTaskType.TEXT_TO_SQL,
  };
};

export const hydrateCreatedThreadResponse = ({
  response,
  taskId,
  fallbackAskingTask,
}: {
  response: ThreadResponse;
  taskId?: string;
  fallbackAskingTask?: AskingTask | null;
}): ThreadResponse => {
  if (response.askingTask || !taskId) {
    return response;
  }

  const askingTask = buildPendingFollowUpAskingTask({
    taskId,
    fallbackAskingTask,
  });

  if (!askingTask) {
    return response;
  }

  return {
    ...response,
    askingTask,
  };
};

export const resolveCreatedThreadResponsePollingTaskId = ({
  response,
  taskId,
}: {
  response: ThreadResponse;
  taskId?: string | null;
}) => {
  const nextTaskId = response.askingTask?.queryId || taskId || null;
  if (!nextTaskId) {
    return null;
  }

  return getIsFinished(response.askingTask?.status) ? null : nextTaskId;
};
