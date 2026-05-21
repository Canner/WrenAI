import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cloneDeep } from 'lodash';
import { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import { THREAD } from '@/apollo/client/graphql/home';
import { nextTick } from '@/utils/time';
import {
  useAdjustThreadResponseMutation,
  useCancelAdjustmentTaskMutation,
  useRerunAdjustmentTaskMutation,
  useThreadResponseLazyQuery,
} from '@/apollo/client/graphql/home.generated';
import {
  AskingTaskStatus,
  DetailedThread,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';

const ADJUSTMENT_POLL_INTERVAL_MS = 2000;
const ADJUSTMENT_POLL_MAX_INTERVAL_MS = 10000;

export const getIsFinished = (status: AskingTaskStatus) =>
  [
    AskingTaskStatus.FINISHED,
    AskingTaskStatus.FAILED,
    AskingTaskStatus.STOPPED,
  ].includes(status);

const handleUpdateThreadCache = (
  threadId: number,
  threadResponse: ThreadResponse,
  client: ApolloClient<NormalizedCacheObject>,
) => {
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
      (existingData) => {
        const isNewResponse = !existingData.thread.responses
          .map((r) => r.id)
          .includes(threadResponse.id);
        return {
          thread: {
            ...existingData.thread,
            responses: isNewResponse
              ? [...existingData.thread.responses, threadResponse]
              : existingData.thread.responses.map((response) => {
                  return response.id === threadResponse.id
                    ? cloneDeep(threadResponse)
                    : response;
                }),
          },
        };
      },
    );
  }
};

export default function useAdjustAnswer(threadId?: number) {
  const [cancelAdjustmentTask] = useCancelAdjustmentTaskMutation({
    onError: (error) => console.error(error),
  });
  const [rerunAdjustmentTask] = useRerunAdjustmentTaskMutation({
    onError: (error) => console.error(error),
  });
  const [adjustThreadResponse, adjustThreadResponseResult] =
    useAdjustThreadResponseMutation({
      onError: (error) => console.error(error),
    });
  const [fetchThreadResponse, threadResponseResult] =
    useThreadResponseLazyQuery();
  const threadResponsePollingRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const threadResponsePollingSessionRef = useRef(0);
  const threadResponsePollingTargetRef = useRef<number | null>(null);
  const threadResponsePollingRequestRef = useRef<Promise<void> | null>(null);
  const threadResponsePollingDelayRef = useRef(ADJUSTMENT_POLL_INTERVAL_MS);
  const lastAdjustmentTaskFingerprintRef = useRef<string | null>(null);

  const loading = adjustThreadResponseResult.loading;

  const adjustmentTask = useMemo(() => {
    return threadResponseResult.data?.threadResponse.adjustmentTask || null;
  }, [threadResponseResult.data]);

  const data = useMemo(() => {
    return {
      adjustmentTask,
    };
  }, [adjustmentTask]);

  const stopThreadResponsePolling = useCallback(() => {
    threadResponsePollingSessionRef.current += 1;
    threadResponsePollingTargetRef.current = null;
    if (threadResponsePollingRef.current) {
      clearTimeout(threadResponsePollingRef.current);
      threadResponsePollingRef.current = null;
    }
    threadResponsePollingDelayRef.current = ADJUSTMENT_POLL_INTERVAL_MS;
  }, []);

  const startThreadResponsePolling = useCallback(
    async (responseId?: number) => {
      if (!responseId) return;
      if (
        threadResponsePollingTargetRef.current === responseId &&
        (threadResponsePollingRequestRef.current || threadResponsePollingRef.current)
      ) {
        return;
      }

      stopThreadResponsePolling();
      threadResponsePollingTargetRef.current = responseId;
      const pollingSessionId = threadResponsePollingSessionRef.current;

      const run = async () => {
        if (threadResponsePollingSessionRef.current !== pollingSessionId) return;
        if (threadResponsePollingRequestRef.current) {
          await threadResponsePollingRequestRef.current;
          if (threadResponsePollingSessionRef.current !== pollingSessionId) return;
        }

        try {
          const request = fetchThreadResponse({
            variables: { responseId },
          }).then(() => undefined);
          threadResponsePollingRequestRef.current = request;
          await request;
        } catch (error) {
          console.error(error);
        } finally {
          threadResponsePollingRequestRef.current = null;
          if (threadResponsePollingSessionRef.current === pollingSessionId) {
            threadResponsePollingRef.current = setTimeout(
              run,
              threadResponsePollingDelayRef.current,
            );
          }
        }
      };

      await run();
    },
    [fetchThreadResponse, stopThreadResponsePolling],
  );

  useEffect(() => {
    const isFinished = getIsFinished(adjustmentTask?.status);
    if (isFinished) stopThreadResponsePolling();
  }, [adjustmentTask?.status]);

  useEffect(() => {
    const fingerprint = JSON.stringify({
      queryId: adjustmentTask?.queryId || null,
      status: adjustmentTask?.status || null,
      sql: adjustmentTask?.sql || null,
      errorCode: adjustmentTask?.error?.code || null,
      invalidSql: adjustmentTask?.invalidSql || null,
    });

    if (lastAdjustmentTaskFingerprintRef.current === fingerprint) {
      threadResponsePollingDelayRef.current = Math.min(
        threadResponsePollingDelayRef.current * 2,
        ADJUSTMENT_POLL_MAX_INTERVAL_MS,
      );
    } else {
      threadResponsePollingDelayRef.current = ADJUSTMENT_POLL_INTERVAL_MS;
      lastAdjustmentTaskFingerprintRef.current = fingerprint;
    }
  }, [
    adjustmentTask?.queryId,
    adjustmentTask?.status,
    adjustmentTask?.sql,
    adjustmentTask?.error?.code,
    adjustmentTask?.invalidSql,
  ]);

  const onAdjustReasoningSteps = async (
    responseId: number,
    input: { tables: string[]; sqlGenerationReasoning: string },
  ) => {
    if (!responseId) return;

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
    if (!nextThreadResponse?.id) return;

    await startThreadResponsePolling(nextThreadResponse.id);

    // update new thread response to cache
    handleUpdateThreadCache(
      threadId,
      nextThreadResponse,
      threadResponseResult.client,
    );
  };

  const onAdjustSQL = async (responseId: number, sql: string) => {
    if (!responseId) return;

    const response = await adjustThreadResponse({
      variables: { responseId, data: { sql } },
    });

    // update thread cache
    const nextThreadResponse = response.data?.adjustThreadResponse;
    if (!nextThreadResponse) return;

    handleUpdateThreadCache(
      threadId,
      nextThreadResponse,
      threadResponseResult.client,
    );

    // It won't have adjusmentTask, no need to fetch
  };

  const onStop = async (queryId?: string) => {
    const taskId =
      queryId ||
      adjustThreadResponseResult.data?.adjustThreadResponse?.adjustmentTask
        ?.queryId;
    if (taskId) {
      await cancelAdjustmentTask({ variables: { taskId } });
      // waiting for polling fetching stop
      await nextTick(1000);
    }
  };

  const onReRun = async (threadResponse: ThreadResponse) => {
    const responseId = threadResponse.id;
    if (!responseId) return;

    await rerunAdjustmentTask({ variables: { responseId } });
    await startThreadResponsePolling(responseId);
  };

  useEffect(() => {
    return () => {
      stopThreadResponsePolling();
    };
  }, [stopThreadResponsePolling]);

  return {
    data,
    loading,
    onAdjustReasoningSteps,
    onAdjustSQL,
    onStop,
    onReRun,
  };
}
