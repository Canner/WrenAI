import { useEffect, useMemo } from 'react';
import { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import { THREAD } from '@/apollo/client/graphql/home';
import { nextTick } from '@/utils/time';
import {
  useAdjustThreadResponseMutation,
  useAdjustmentTaskLazyQuery,
  useCancelAdjustmentTaskMutation,
  useRerunAdjustmentTaskMutation,
} from '@/apollo/client/graphql/home.generated';
import {
  AskingTaskStatus,
  DetailedThread,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';

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
        return {
          thread: {
            ...existingData.thread,
            responses: [...existingData.thread.responses, threadResponse],
          },
        };
      },
    );
  }
};

export default function useAdjustAnswer(threadId?: number) {
  const [cancelAdjustmentTask] = useCancelAdjustmentTaskMutation();
  const [rerunAdjustmentTask] = useRerunAdjustmentTaskMutation();
  const [adjustThreadResponse, adjustThreadResponseResult] =
    useAdjustThreadResponseMutation();
  const [fetchAdjustmentTask, adjustmentTaskResult] =
    useAdjustmentTaskLazyQuery({
      pollInterval: 1000,
    });

  const loading = adjustThreadResponseResult.loading;

  const adjustmentTask = useMemo(() => {
    return adjustmentTaskResult.data?.adjustmentTask || null;
  }, [adjustmentTaskResult.data]);

  const data = useMemo(() => {
    return {
      adjustmentTask,
    };
  }, [adjustmentTask]);

  useEffect(() => {
    const isFinished = getIsFinished(
      adjustmentTaskResult.data?.adjustmentTask?.status,
    );
    if (isFinished) adjustmentTaskResult.stopPolling();
  }, [adjustmentTaskResult.data?.adjustmentTask?.status]);

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
    // TODO: wait to readjust adjustment flow
    // update thread cache
    const nextThreadResponse = response.data?.adjustThreadResponse;
    handleUpdateThreadCache(
      threadId,
      nextThreadResponse,
      adjustmentTaskResult.client,
    );
    // start polling
    const taskId = nextThreadResponse?.adjustmentTask?.queryId;
    fetchAdjustmentTask({ variables: { taskId } });
  };

  const onAdjustSQL = async (responseId: number, sql: string) => {
    await adjustThreadResponse({
      variables: { responseId, data: { sql } },
    });
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

  const onReRun = async (responseId: number) => {
    await rerunAdjustmentTask({ variables: { responseId } });
    // TODO: wait backend to provide taskId
    // const taskId = response.data?.rerunAdjustmentTask?.id;
    // fetchAdjustmentTask({ variables: { taskId } });
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
