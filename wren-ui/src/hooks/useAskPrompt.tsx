import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloneDeep, uniq } from 'lodash';
import {
  AdjustmentTask,
  AskingTask,
  AskingTaskStatus,
  AskingTaskType,
  DetailedThread,
  RecommendedQuestionsTask,
  RecommendedQuestionsTaskStatus,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import {
  useAskingTaskLazyQuery,
  useCancelAskingTaskMutation,
  useCreateAskingTaskMutation,
  useRerunAskingTaskMutation,
  useCreateInstantRecommendedQuestionsMutation,
  useInstantRecommendedQuestionsLazyQuery,
} from '@/apollo/client/graphql/home.generated';
import useAskingStreamTask from './useAskingStreamTask';
import { THREAD } from '@/apollo/client/graphql/home';
import { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import { nextTick } from '@/utils/time';

export interface AskPromptData {
  originalQuestion: string;
  askingTask?: AskingTask;
  askingStreamTask?: string;
  recommendedQuestions?: RecommendedQuestionsTask;
}

export const getIsFinished = (status: AskingTaskStatus) =>
  [
    AskingTaskStatus.FINISHED,
    AskingTaskStatus.FAILED,
    AskingTaskStatus.STOPPED,
  ].includes(status);

export const canGenerateAnswer = (
  askingTask: AskingTask,
  adjustmentTask: AdjustmentTask,
) =>
  (askingTask === null && adjustmentTask === null) ||
  askingTask?.status === AskingTaskStatus.FINISHED ||
  adjustmentTask?.status === AskingTaskStatus.FINISHED;

export const canFetchThreadResponse = (askingTask: AskingTask) =>
  askingTask !== null &&
  askingTask?.status !== AskingTaskStatus.FAILED &&
  askingTask?.status !== AskingTaskStatus.STOPPED;

export const isReadyToThreadResponse = (askingTask: AskingTask) =>
  askingTask?.status === AskingTaskStatus.SEARCHING &&
  askingTask?.type === AskingTaskType.TEXT_TO_SQL;

export const isRecommendedFinished = (status: RecommendedQuestionsTaskStatus) =>
  [
    RecommendedQuestionsTaskStatus.FINISHED,
    RecommendedQuestionsTaskStatus.FAILED,

    // for existing thread response & existing projects that are not executed to generate recommendation questions
    RecommendedQuestionsTaskStatus.NOT_STARTED,
  ].includes(status);

const isNeedRecommendedQuestions = (askingTask: AskingTask) => {
  const isGeneralOrMisleadingQuery = [
    AskingTaskType.GENERAL,
    AskingTaskType.MISLEADING_QUERY,
  ].includes(askingTask?.type);
  const isFailed =
    askingTask?.type !== AskingTaskType.TEXT_TO_SQL &&
    askingTask?.status === AskingTaskStatus.FAILED;
  return isGeneralOrMisleadingQuery || isFailed;
};

const isNeedPreparing = (askingTask: AskingTask) =>
  askingTask?.type === AskingTaskType.TEXT_TO_SQL;

const handleUpdateThreadCache = (
  threadId: number,
  askingTask: AskingTask,
  client: ApolloClient<NormalizedCacheObject>,
) => {
  if (!askingTask) return;

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
            responses: existingData.thread.responses.map((response) => {
              if (response.askingTask?.queryId === askingTask?.queryId) {
                return {
                  ...response,
                  askingTask: cloneDeep(askingTask),
                };
              }
              return response;
            }),
          },
        };
      },
    );
  }
};

const handleUpdateRerunAskingTaskCache = (
  threadId: number,
  threadResponseId: number,
  askingTask: AskingTask,
  client: ApolloClient<NormalizedCacheObject>,
) => {
  if (!askingTask) return;

  const result = client.cache.readQuery<{ thread: DetailedThread }>({
    query: THREAD,
    variables: { threadId },
  });

  if (result?.thread) {
    const task = cloneDeep(askingTask);
    // bypass understanding status to thread response
    if (task.status === AskingTaskStatus.UNDERSTANDING) {
      task.status = AskingTaskStatus.SEARCHING;
      task.type = AskingTaskType.TEXT_TO_SQL;
    }
    client.cache.updateQuery(
      {
        query: THREAD,
        variables: { threadId },
      },
      (existingData) => {
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
      },
    );
  }
};

export default function useAskPrompt(threadId?: number) {
  const [originalQuestion, setOriginalQuestion] = useState<string>('');
  const [threadQuestions, setThreadQuestions] = useState<string[]>([]);
  // Handle errors via try/catch blocks rather than onError callback
  const [createAskingTask, createAskingTaskResult] =
    useCreateAskingTaskMutation();
  const [cancelAskingTask] = useCancelAskingTaskMutation({
    onError: (error) => console.error(error),
  });
  const [rerunAskingTask] = useRerunAskingTaskMutation({
    onError: (error) => console.error(error),
  });
  const [fetchAskingTask, askingTaskResult] = useAskingTaskLazyQuery({
    fetchPolicy: 'network-only',
    nextFetchPolicy: 'network-only',
  });
  const [fetchAskingStreamTask, askingStreamTaskResult] = useAskingStreamTask();
  const [createInstantRecommendedQuestions] =
    useCreateInstantRecommendedQuestionsMutation({
      onError: (error) => console.error(error),
    });
  const [fetchInstantRecommendedQuestions, instantRecommendedQuestionsResult] =
    useInstantRecommendedQuestionsLazyQuery({
      fetchPolicy: 'network-only',
      nextFetchPolicy: 'network-only',
    });
  const askingTaskPollingRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const recommendedPollingRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const askingTask = useMemo(
    () => askingTaskResult.data?.askingTask || null,
    [askingTaskResult.data],
  );
  const askingTaskType = useMemo(() => askingTask?.type, [askingTask?.type]);
  const askingStreamTask = askingStreamTaskResult.data;
  const recommendedQuestions = useMemo(
    () =>
      instantRecommendedQuestionsResult.data?.instantRecommendedQuestions ||
      null,
    [instantRecommendedQuestionsResult.data],
  );

  const loading = askingStreamTaskResult.loading;

  const stopAskingTaskPolling = useCallback(() => {
    if (askingTaskPollingRef.current) {
      clearInterval(askingTaskPollingRef.current);
      askingTaskPollingRef.current = null;
    }
  }, []);

  const stopRecommendedPolling = useCallback(() => {
    if (recommendedPollingRef.current) {
      clearInterval(recommendedPollingRef.current);
      recommendedPollingRef.current = null;
    }
  }, []);

  const startAskingTaskPolling = useCallback(
    async (taskId?: string) => {
      if (!taskId) return;

      stopAskingTaskPolling();

      const run = async () => {
        try {
          await fetchAskingTask({
            variables: { taskId },
          });
        } catch (error) {
          console.error(error);
        }
      };

      await run();
      askingTaskPollingRef.current = setInterval(run, 1000);
    },
    [fetchAskingTask, stopAskingTaskPolling],
  );

  const startRecommendedPolling = useCallback(
    async (taskId?: string) => {
      if (!taskId) return;

      stopRecommendedPolling();

      const run = async () => {
        try {
          await fetchInstantRecommendedQuestions({
            variables: { taskId },
          });
        } catch (error) {
          console.error(error);
        }
      };

      await run();
      recommendedPollingRef.current = setInterval(run, 1000);
    },
    [fetchInstantRecommendedQuestions, stopRecommendedPolling],
  );

  const data = useMemo(
    () => ({
      originalQuestion,
      askingTask,
      askingStreamTask,
      recommendedQuestions,
    }),
    [originalQuestion, askingTask, askingStreamTask, recommendedQuestions],
  );

  const startRecommendedQuestions = useCallback(async () => {
    if (!originalQuestion?.trim()) return;

    const previousQuestions = [
      // slice the last 5 questions in threadQuestions
      ...uniq(threadQuestions).slice(-5),
      originalQuestion,
    ];
    const response = await createInstantRecommendedQuestions({
      variables: { data: { previousQuestions } },
    });
    const taskId = response.data?.createInstantRecommendedQuestions?.id;
    if (!taskId) return;

    await startRecommendedPolling(taskId);
  }, [originalQuestion, threadQuestions, startRecommendedPolling]);

  const checkFetchAskingStreamTask = useCallback(
    (task: AskingTask) => {
      if (
        !askingStreamTask &&
        task?.queryId &&
        task.status === AskingTaskStatus.PLANNING
      ) {
        fetchAskingStreamTask(task.queryId);
      }
    },
    [askingStreamTask],
  );

  useEffect(() => {
    const isFinished = getIsFinished(askingTask?.status);
    if (isFinished) stopAskingTaskPolling();

    // handle update cache for preparing component
    if (isNeedPreparing(askingTask)) {
      if (threadId) {
        handleUpdateThreadCache(threadId, askingTask, askingTaskResult.client);
        checkFetchAskingStreamTask(askingTask);
      }
    }
  }, [askingTask?.status, threadId, checkFetchAskingStreamTask]);

  useEffect(() => {
    // handle instant recommended questions
    if (isNeedRecommendedQuestions(askingTask)) {
      startRecommendedQuestions();
    }
  }, [askingTask?.type]);

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestions?.status)) {
      stopRecommendedPolling();
    }
  }, [recommendedQuestions]);

  useEffect(() => {
    const taskId = createAskingTaskResult.data?.createAskingTask.id;
    if (taskId && askingTaskType === AskingTaskType.GENERAL) {
      fetchAskingStreamTask(taskId);
    }
  }, [askingTaskType, createAskingTaskResult.data]);

  const onStop = async (queryId?: string) => {
    const taskId = queryId || createAskingTaskResult.data?.createAskingTask.id;
    if (taskId) {
      await cancelAskingTask({ variables: { taskId } }).catch((error) =>
        console.error(error),
      );
      stopAskingTaskPolling();
      // waiting for polling fetching stop
      await nextTick(1000);
    }
  };

  const onReRun = async (threadResponse: ThreadResponse) => {
    if (!threadResponse?.id) return;

    askingStreamTaskResult.reset();
    setOriginalQuestion(threadResponse.question);
    try {
      const response = await rerunAskingTask({
        variables: { responseId: threadResponse.id },
      });
      const taskId = response.data?.rerunAskingTask?.id;
      if (!taskId) return;

      const { data } = await fetchAskingTask({ variables: { taskId } });
      if (!data?.askingTask) return;

      await startAskingTaskPolling(taskId);

      // update the asking task in cache manually
      handleUpdateRerunAskingTaskCache(
        threadId,
        threadResponse.id,
        data.askingTask,
        askingTaskResult.client,
      );
    } catch (error) {
      console.error(error);
    }
  };

  const onSubmit = async (value) => {
    askingStreamTaskResult.reset();
    setOriginalQuestion(value);
    try {
      const response = await createAskingTask({
        variables: { data: { question: value, threadId } },
      });
      const taskId = response.data?.createAskingTask?.id;
      if (!taskId) return;

      await startAskingTaskPolling(taskId);
    } catch (error) {
      console.error(error);
    }
  };

  const onFetching = async (queryId: string) => {
    if (!queryId) return;

    await startAskingTaskPolling(queryId);
  };

  const onStopPolling = () => stopAskingTaskPolling();

  const onStopStreaming = () => askingStreamTaskResult.reset();

  const onStopRecommend = () => stopRecommendedPolling();

  useEffect(() => {
    return () => {
      stopAskingTaskPolling();
      stopRecommendedPolling();
    };
  }, [stopAskingTaskPolling, stopRecommendedPolling]);

  const onStoreThreadQuestions = (questions: string[]) =>
    setThreadQuestions(questions);

  return {
    data,
    loading,
    onStop,
    onReRun,
    onSubmit,
    onFetching,
    onStopPolling,
    onStopStreaming,
    onStopRecommend,
    onStoreThreadQuestions,
    inputProps: {
      placeholder: threadId
        ? 'Ask follow-up questions to explore your data'
        : 'Ask to explore your data',
    },
  };
}
