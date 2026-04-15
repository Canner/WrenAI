import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cloneDeep } from 'lodash';
import { message } from 'antd';
import { ApolloClient } from '@apollo/client';
import type { ClientRuntimeScopeSelector } from '@/apollo/client/runtimeScope';
import { THREAD } from '@/apollo/client/graphql/home';
import {
  useAdjustThreadResponseMutation,
  useCancelAdjustmentTaskMutation,
  useRerunAdjustmentTaskMutation,
} from '@/apollo/client/graphql/home.generated';
import {
  AskingTaskStatus,
  DetailedThread,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import type {
  ThreadDetailQueryData,
  UpdateThreadDetailQuery,
} from './useThreadDetail';
import useThreadResponsePolling from './useThreadResponsePolling';

const ADJUSTMENT_POLL_INTERVAL_MS = 1500;
const ADJUSTMENT_POLL_TIMEOUT_MS = 45_000;

export const getIsFinished = (status?: AskingTaskStatus | null) =>
  status !== undefined &&
  status !== null &&
  [
    AskingTaskStatus.FINISHED,
    AskingTaskStatus.FAILED,
    AskingTaskStatus.STOPPED,
  ].includes(status as AskingTaskStatus);

const handleUpdateThreadCache = (
  threadId: number,
  threadResponse: ThreadResponse,
  client: ApolloClient<object>,
  updateThreadQuery?: UpdateThreadDetailQuery,
) => {
  const updater = (
    existingData: ThreadDetailQueryData | null,
  ): ThreadDetailQueryData | null => {
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
          : existingData.thread.responses.map((response: ThreadResponse) => {
              return response.id === threadResponse.id
                ? cloneDeep(threadResponse)
                : response;
            }),
      },
    };
  };

  const result = client.cache.readQuery<{ thread: DetailedThread }>({
    query: THREAD,
    variables: { threadId },
  });

  if (result?.thread) {
    client.cache.updateQuery(
      {
        query: THREAD,
        variables: { threadId },
      },
      (existingData: { thread: DetailedThread } | null) => {
        return updater(existingData as ThreadDetailQueryData) as {
          thread: DetailedThread;
        } | null;
      },
    );
  }

  updateThreadQuery?.((existingData) => {
    return updater(existingData) || existingData;
  });
};

export default function useAdjustAnswer(
  threadId?: number,
  updateThreadQuery?: UpdateThreadDetailQuery,
  runtimeScopeSelector?: ClientRuntimeScopeSelector,
) {
  const adjustmentPollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [cancelAdjustmentTask] = useCancelAdjustmentTaskMutation({
    onError: (_error) => {
      message.error('停止调整任务失败，请稍后重试');
    },
  });
  const [rerunAdjustmentTask] = useRerunAdjustmentTaskMutation({
    onError: (_error) => {
      message.error('重试调整任务失败，请稍后重试');
    },
  });
  const [adjustThreadResponse, adjustThreadResponseResult] =
    useAdjustThreadResponseMutation({
      onError: (_error) => {
        message.error('调整回答失败，请稍后重试');
      },
    });
  const {
    data: threadResponse,
    fetchById: fetchThreadResponse,
    stopPolling: stopThreadResponsePolling,
  } = useThreadResponsePolling({
    runtimeScopeSelector,
    pollInterval: ADJUSTMENT_POLL_INTERVAL_MS,
    onCompleted: (nextThreadResponse) => {
      if (!threadId) {
        return;
      }

      handleUpdateThreadCache(
        threadId,
        nextThreadResponse,
        adjustThreadResponseResult.client,
        updateThreadQuery,
      );
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

  const loading = adjustThreadResponseResult.loading;

  const adjustmentTask = useMemo(() => {
    return threadResponse?.adjustmentTask || null;
  }, [threadResponse]);

  const data = useMemo(() => {
    return {
      adjustmentTask,
    };
  }, [adjustmentTask]);

  useEffect(() => {
    const isFinished = getIsFinished(adjustmentTask?.status);
    if (isFinished) {
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
    const response = await adjustThreadResponse({
      variables: {
        responseId,
        data: {
          tables: input.tables,
          sqlGenerationReasoning: input.sqlGenerationReasoning,
        },
      },
    });

    // start polling new thread response
    const nextThreadResponse = response.data?.adjustThreadResponse;
    if (!nextThreadResponse) {
      message.error('调整回答失败，请稍后重试');
      return;
    }
    await fetchThreadResponseWithGuard(nextThreadResponse.id);

    // update new thread response to cache
    if (threadId) {
      handleUpdateThreadCache(
        threadId,
        nextThreadResponse,
        adjustThreadResponseResult.client,
        updateThreadQuery,
      );
    }
  };

  const onAdjustSQL = async (responseId: number, sql: string) => {
    const response = await adjustThreadResponse({
      variables: { responseId, data: { sql } },
    });

    // update thread cache
    const nextThreadResponse = response.data?.adjustThreadResponse;
    if (!nextThreadResponse) {
      message.error('调整回答失败，请稍后重试');
      return;
    }
    if (threadId) {
      handleUpdateThreadCache(
        threadId,
        nextThreadResponse,
        adjustThreadResponseResult.client,
        updateThreadQuery,
      );
    }

    // It won't have adjusmentTask, no need to fetch
  };

  const onStop = async (queryId?: string) => {
    const taskId =
      queryId ||
      adjustThreadResponseResult.data?.adjustThreadResponse?.adjustmentTask
        ?.queryId;
    if (taskId) {
      await cancelAdjustmentTask({ variables: { taskId } });
      stopThreadResponsePolling();
      clearAdjustmentPollingTimeout();
    }
  };

  const onReRun = async (threadResponse: ThreadResponse) => {
    const responseId = threadResponse.id;
    try {
      await rerunAdjustmentTask({ variables: { responseId } });
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
