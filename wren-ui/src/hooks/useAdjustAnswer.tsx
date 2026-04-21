import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloneDeep } from 'lodash';

import { appMessage as message } from '@/utils/antdAppBridge';
import {
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { AskingTaskStatus, ThreadResponse } from '@/types/home';
import {
  adjustThreadResponseAnswer,
  cancelAdjustmentTask,
  rerunAdjustmentTask,
} from '@/utils/homeRest';
import type {
  ThreadDetailStateData,
  UpdateThreadDetailState,
} from './useThreadDetail';
import useThreadResponsePolling from './useThreadResponsePolling';
import { ANSWER_FINALIZATION_POLL_TIMEOUT_MS } from '@/utils/askingTimeouts';

const ADJUSTMENT_POLL_INTERVAL_MS = 1500;
const ADJUSTMENT_POLL_TIMEOUT_MS = ANSWER_FINALIZATION_POLL_TIMEOUT_MS;

export const getIsFinished = (status?: AskingTaskStatus | null) =>
  status !== undefined &&
  status !== null &&
  [
    AskingTaskStatus.FINISHED,
    AskingTaskStatus.FAILED,
    AskingTaskStatus.STOPPED,
  ].includes(status as AskingTaskStatus);

const handleUpdateThreadCache = (
  threadResponse: ThreadResponse,
  updateThreadQuery?: UpdateThreadDetailState,
) => {
  if (!updateThreadQuery) {
    return;
  }

  updateThreadQuery((existingData: ThreadDetailStateData) => {
    if (!existingData?.thread) {
      return existingData;
    }

    const isNewResponse = !existingData.thread.responses
      .map((response: ThreadResponse) => response.id)
      .includes(threadResponse.id);

    return {
      thread: {
        ...existingData.thread,
        responses: isNewResponse
          ? [...existingData.thread.responses, threadResponse]
          : existingData.thread.responses.map((response: ThreadResponse) =>
              response.id === threadResponse.id
                ? cloneDeep(threadResponse)
                : response,
            ),
      },
    };
  });
};

const resolveRuntimeScopeSelector = (selector?: ClientRuntimeScopeSelector) =>
  selector || resolveClientRuntimeScopeSelector();

export default function useAdjustAnswer(
  threadId?: number,
  updateThreadQuery?: UpdateThreadDetailState,
  runtimeScopeSelector?: ClientRuntimeScopeSelector,
) {
  const adjustmentPollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const lastAdjustmentTaskIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    data: threadResponse,
    fetchById: fetchThreadResponse,
    stopPolling: stopThreadResponsePolling,
  } = useThreadResponsePolling({
    runtimeScopeSelector,
    pollInterval: ADJUSTMENT_POLL_INTERVAL_MS,
    onCompleted: (nextThreadResponse) => {
      if (nextThreadResponse.adjustmentTask?.queryId) {
        lastAdjustmentTaskIdRef.current =
          nextThreadResponse.adjustmentTask.queryId;
      }
      handleUpdateThreadCache(nextThreadResponse, updateThreadQuery);
    },
    onError: () => {
      message.error('加载调整结果失败，请稍后重试');
    },
  });

  const clearAdjustmentPollingTimeout = useCallback(() => {
    if (adjustmentPollingTimeoutRef.current) {
      clearTimeout(adjustmentPollingTimeoutRef.current);
      adjustmentPollingTimeoutRef.current = null;
    }
  }, []);

  const scheduleAdjustmentPollingStop = useCallback(() => {
    clearAdjustmentPollingTimeout();
    adjustmentPollingTimeoutRef.current = setTimeout(() => {
      stopThreadResponsePolling();
      message.warning('调整任务轮询超时，请稍后重试');
    }, ADJUSTMENT_POLL_TIMEOUT_MS);
  }, [clearAdjustmentPollingTimeout, stopThreadResponsePolling]);

  const fetchThreadResponseWithGuard = useCallback(
    async (responseId: number) => {
      clearAdjustmentPollingTimeout();
      stopThreadResponsePolling();
      const response = await fetchThreadResponse(responseId);
      scheduleAdjustmentPollingStop();
      return response;
    },
    [
      clearAdjustmentPollingTimeout,
      fetchThreadResponse,
      scheduleAdjustmentPollingStop,
      stopThreadResponsePolling,
    ],
  );

  const adjustmentTask = useMemo(
    () => threadResponse?.adjustmentTask || null,
    [threadResponse],
  );

  const data = useMemo(
    () => ({
      adjustmentTask,
    }),
    [adjustmentTask],
  );

  useEffect(() => {
    if (getIsFinished(adjustmentTask?.status)) {
      stopThreadResponsePolling();
      clearAdjustmentPollingTimeout();
    }
  }, [
    adjustmentTask?.status,
    clearAdjustmentPollingTimeout,
    stopThreadResponsePolling,
  ]);

  useEffect(() => {
    return () => {
      clearAdjustmentPollingTimeout();
    };
  }, [clearAdjustmentPollingTimeout]);

  const onAdjustReasoningSteps = async (
    responseId: number,
    input: { tables: string[]; sqlGenerationReasoning: string },
  ) => {
    setLoading(true);
    try {
      const nextThreadResponse = await adjustThreadResponseAnswer(
        resolveRuntimeScopeSelector(runtimeScopeSelector),
        responseId,
        {
          tables: input.tables,
          sqlGenerationReasoning: input.sqlGenerationReasoning,
        },
      );

      if (!nextThreadResponse) {
        message.error('调整回答失败，请稍后重试');
        return;
      }

      if (nextThreadResponse.adjustmentTask?.queryId) {
        lastAdjustmentTaskIdRef.current =
          nextThreadResponse.adjustmentTask.queryId;
      }

      await fetchThreadResponseWithGuard(nextThreadResponse.id);
      if (threadId) {
        handleUpdateThreadCache(nextThreadResponse, updateThreadQuery);
      }
    } catch (_error) {
      message.error('调整回答失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const onAdjustSQL = async (responseId: number, sql: string) => {
    setLoading(true);
    try {
      const nextThreadResponse = await adjustThreadResponseAnswer(
        resolveRuntimeScopeSelector(runtimeScopeSelector),
        responseId,
        { sql },
      );

      if (!nextThreadResponse) {
        message.error('调整回答失败，请稍后重试');
        return;
      }

      if (nextThreadResponse.adjustmentTask?.queryId) {
        lastAdjustmentTaskIdRef.current =
          nextThreadResponse.adjustmentTask.queryId;
      }

      if (threadId) {
        handleUpdateThreadCache(nextThreadResponse, updateThreadQuery);
      }
    } catch (_error) {
      message.error('调整回答失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const onStop = async (queryId?: string) => {
    const taskId =
      queryId ||
      threadResponse?.adjustmentTask?.queryId ||
      lastAdjustmentTaskIdRef.current;
    if (!taskId) {
      return;
    }

    try {
      await cancelAdjustmentTask(
        resolveRuntimeScopeSelector(runtimeScopeSelector),
        taskId,
      );
      stopThreadResponsePolling();
      clearAdjustmentPollingTimeout();
    } catch (_error) {
      message.error('停止调整任务失败，请稍后重试');
    }
  };

  const onReRun = async (currentThreadResponse: ThreadResponse) => {
    const responseId = currentThreadResponse.id;
    try {
      await rerunAdjustmentTask(
        resolveRuntimeScopeSelector(runtimeScopeSelector),
        responseId,
      );
      await fetchThreadResponseWithGuard(responseId);
    } catch (_error) {
      message.error('重试调整失败，请稍后重试');
    }
  };

  return {
    data,
    loading,
    onAdjustReasoningSteps,
    onAdjustSQL,
    onStop,
    onReRun,
  };
}
