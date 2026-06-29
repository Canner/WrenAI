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

const ASKING_TASK_POLL_INTERVAL_MS = 2000;
const RECOMMENDED_QUESTIONS_POLL_INTERVAL_MS = 2000;
const ASKING_TASK_POLL_MAX_INTERVAL_MS = 10000;
const RECOMMENDED_QUESTIONS_POLL_MAX_INTERVAL_MS = 10000;

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
  const askingTaskPollingRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const askingTaskPollingSessionRef = useRef(0);
  const askingTaskPollingTargetRef = useRef<string | null>(null);
  const askingTaskPollingRequestRef = useRef<Promise<void> | null>(null);
  const askingTaskPollingDelayRef = useRef(ASKING_TASK_POLL_INTERVAL_MS);
  const lastAskingTaskFingerprintRef = useRef<string | null>(null);
  const recommendedPollingRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const recommendedPollingSessionRef = useRef(0);
  const recommendedPollingTargetRef = useRef<string | null>(null);
  const recommendedPollingRequestRef = useRef<Promise<void> | null>(null);
  const recommendedPollingDelayRef = useRef(
    RECOMMENDED_QUESTIONS_POLL_INTERVAL_MS,
  );
  const lastRecommendedFingerprintRef = useRef<string | null>(null);
  const recommendedCreationKeyRef = useRef<string | null>(null);
  const recommendedCreationRequestRef = useRef<Promise<void> | null>(null);

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
    askingTaskPollingSessionRef.current += 1;
    askingTaskPollingTargetRef.current = null;
    if (askingTaskPollingRef.current) {
      clearTimeout(askingTaskPollingRef.current);
      askingTaskPollingRef.current = null;
    }
    askingTaskPollingDelayRef.current = ASKING_TASK_POLL_INTERVAL_MS;
  }, []);

  const stopRecommendedPolling = useCallback(() => {
    recommendedPollingSessionRef.current += 1;
    recommendedPollingTargetRef.current = null;
    if (recommendedPollingRef.current) {
      clearTimeout(recommendedPollingRef.current);
      recommendedPollingRef.current = null;
    }
    recommendedPollingDelayRef.current = RECOMMENDED_QUESTIONS_POLL_INTERVAL_MS;
    recommendedCreationKeyRef.current = null;
    recommendedCreationRequestRef.current = null;
  }, []);

  const startAskingTaskPolling = useCallback(
    async (taskId?: string) => {
      if (!taskId) return;
      if (
        askingTaskPollingTargetRef.current === taskId &&
        (askingTaskPollingRequestRef.current || askingTaskPollingRef.current)
      ) {
        return;
      }

      stopAskingTaskPolling();
      askingTaskPollingTargetRef.current = taskId;
      const pollingSessionId = askingTaskPollingSessionRef.current;

      const run = async () => {
        if (askingTaskPollingSessionRef.current !== pollingSessionId) return;
        if (askingTaskPollingRequestRef.current) {
          await askingTaskPollingRequestRef.current;
          if (askingTaskPollingSessionRef.current !== pollingSessionId) return;
        }

        let shouldContinuePolling = true;
        try {
          const request = fetchAskingTask({
            variables: { taskId },
          });
          askingTaskPollingRequestRef.current = request.then(() => undefined);
          const result = await request;
          const task = result.data?.askingTask;
          if (!task || getIsFinished(task.status)) {
            shouldContinuePolling = false;
            stopAskingTaskPolling();
          }
        } catch (error) {
          console.error(error);
        } finally {
          askingTaskPollingRequestRef.current = null;
          if (
            shouldContinuePolling &&
            askingTaskPollingSessionRef.current === pollingSessionId
          ) {
            askingTaskPollingRef.current = setTimeout(
              run,
              askingTaskPollingDelayRef.current,
            );
          }
        }
      };

      await run();
    },
    [fetchAskingTask, stopAskingTaskPolling],
  );

  const startRecommendedPolling = useCallback(
    async (taskId?: string) => {
      if (!taskId) return;
      if (
        recommendedPollingTargetRef.current === taskId &&
        (recommendedPollingRequestRef.current || recommendedPollingRef.current)
      ) {
        return;
      }

      stopRecommendedPolling();
      recommendedPollingTargetRef.current = taskId;
      const pollingSessionId = recommendedPollingSessionRef.current;

      const run = async () => {
        if (recommendedPollingSessionRef.current !== pollingSessionId) return;
        if (recommendedPollingRequestRef.current) {
          await recommendedPollingRequestRef.current;
          if (recommendedPollingSessionRef.current !== pollingSessionId) return;
        }

        let shouldContinuePolling = true;
        try {
          const request = fetchInstantRecommendedQuestions({
            variables: { taskId },
          });
          recommendedPollingRequestRef.current = request.then(() => undefined);
          const result = await request;
          const task = result.data?.instantRecommendedQuestions;
          if (!task || isRecommendedFinished(task.status)) {
            shouldContinuePolling = false;
            stopRecommendedPolling();
          }
        } catch (error) {
          console.error(error);
        } finally {
          recommendedPollingRequestRef.current = null;
          if (
            shouldContinuePolling &&
            recommendedPollingSessionRef.current === pollingSessionId
          ) {
            recommendedPollingRef.current = setTimeout(
              run,
              recommendedPollingDelayRef.current,
            );
          }
        }
      };

      await run();
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
    const creationKey = JSON.stringify({
      askingQueryId: askingTask?.queryId || null,
      previousQuestions,
    });

    if (recommendedCreationKeyRef.current === creationKey) {
      if (recommendedCreationRequestRef.current) {
        await recommendedCreationRequestRef.current;
      }
      return;
    }

    recommendedCreationKeyRef.current = creationKey;
    const request = (async () => {
      const response = await createInstantRecommendedQuestions({
        variables: { data: { previousQuestions } },
      });
      const taskId = response.data?.createInstantRecommendedQuestions?.id;
      if (!taskId) return;

      await startRecommendedPolling(taskId);
    })();

    recommendedCreationRequestRef.current = request;
    try {
      await request;
    } finally {
      recommendedCreationRequestRef.current = null;
    }
  }, [
    originalQuestion,
    threadQuestions,
    askingTask?.queryId,
    createInstantRecommendedQuestions,
    startRecommendedPolling,
  ]);

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
    const fingerprint = JSON.stringify({
      queryId: askingTask?.queryId || null,
      status: askingTask?.status || null,
      type: askingTask?.type || null,
      candidateCount: askingTask?.candidates?.length || 0,
      errorCode: askingTask?.error?.code || null,
      traceId: askingTask?.traceId || null,
    });

    if (lastAskingTaskFingerprintRef.current === fingerprint) {
      askingTaskPollingDelayRef.current = Math.min(
        askingTaskPollingDelayRef.current * 2,
        ASKING_TASK_POLL_MAX_INTERVAL_MS,
      );
    } else {
      askingTaskPollingDelayRef.current = ASKING_TASK_POLL_INTERVAL_MS;
      lastAskingTaskFingerprintRef.current = fingerprint;
    }
  }, [
    askingTask?.queryId,
    askingTask?.status,
    askingTask?.type,
    askingTask?.candidates?.length,
    askingTask?.error?.code,
    askingTask?.traceId,
  ]);

  useEffect(() => {
    // handle instant recommended questions
    if (isNeedRecommendedQuestions(askingTask)) {
      startRecommendedQuestions();
    }
  }, [askingTask?.type]);

  useEffect(() => {
    const fingerprint = JSON.stringify({
      status: recommendedQuestions?.status || null,
      count: recommendedQuestions?.questions?.length || 0,
      errorCode: recommendedQuestions?.error?.code || null,
    });

    if (lastRecommendedFingerprintRef.current === fingerprint) {
      recommendedPollingDelayRef.current = Math.min(
        recommendedPollingDelayRef.current * 2,
        RECOMMENDED_QUESTIONS_POLL_MAX_INTERVAL_MS,
      );
    } else {
      recommendedPollingDelayRef.current = RECOMMENDED_QUESTIONS_POLL_INTERVAL_MS;
      lastRecommendedFingerprintRef.current = fingerprint;
    }
  }, [
    recommendedQuestions?.status,
    recommendedQuestions?.questions?.length,
    recommendedQuestions?.error?.code,
  ]);

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
