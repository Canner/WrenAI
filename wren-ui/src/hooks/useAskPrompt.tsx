import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloneDeep, uniq } from 'lodash';
import { message } from 'antd';
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
import type {
  ThreadDetailQueryData,
  UpdateThreadDetailQuery,
} from './useThreadDetail';

export interface AskPromptData {
  originalQuestion: string;
  askingTask?: AskingTask | null;
  askingStreamTask?: string;
  recommendedQuestions?: RecommendedQuestionsTask | null;
}

type NullableAskingTask = AskingTask | null | undefined;

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

    // for existing thread response & existing projects that are not executed to generate recommendation questions
    RecommendedQuestionsTaskStatus.NOT_STARTED,
  ].includes(status);

const isNeedRecommendedQuestions = (askingTask: NullableAskingTask) => {
  const isGeneralOrMisleadingQuery =
    askingTask?.type === AskingTaskType.GENERAL ||
    askingTask?.type === AskingTaskType.MISLEADING_QUERY;
  const isFailed =
    askingTask?.type !== AskingTaskType.TEXT_TO_SQL &&
    askingTask?.status === AskingTaskStatus.FAILED;
  return isGeneralOrMisleadingQuery || isFailed;
};

const isNeedPreparing = (askingTask: NullableAskingTask) =>
  askingTask?.type === AskingTaskType.TEXT_TO_SQL;

const ASKING_TASK_POLL_INTERVAL_MS = 1500;
const ASKING_TASK_POLL_TIMEOUT_MS = 45_000;
const INSTANT_RECOMMEND_POLL_INTERVAL_MS = 1500;
const INSTANT_RECOMMEND_POLL_TIMEOUT_MS = 20_000;

export const buildRecommendedQuestionHistory = (
  threadQuestions: string[],
  originalQuestion: string,
) =>
  Array.from(
    new Set(
      [...uniq(threadQuestions).slice(-5), originalQuestion].filter(Boolean),
    ),
  );

const handleUpdateThreadCache = (
  threadId: number,
  askingTask: NullableAskingTask,
  client: ApolloClient<NormalizedCacheObject>,
  updateThreadQuery?: UpdateThreadDetailQuery,
) => {
  if (!askingTask) return;

  const updater = (
    existingData: ThreadDetailQueryData | null,
  ): ThreadDetailQueryData | null => {
    if (!existingData?.thread) {
      return existingData;
    }

    return {
      thread: {
        ...existingData.thread,
        responses: existingData.thread.responses.map(
          (response: DetailedThread['responses'][number]) => {
            if (response.askingTask?.queryId === askingTask?.queryId) {
              return {
                ...response,
                askingTask: cloneDeep(askingTask),
              };
            }
            return response;
          },
        ),
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
      (existingData) => {
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

const handleUpdateRerunAskingTaskCache = (
  threadId: number,
  threadResponseId: number,
  askingTask: NullableAskingTask,
  client: ApolloClient<NormalizedCacheObject>,
  updateThreadQuery?: UpdateThreadDetailQuery,
) => {
  if (!askingTask) return;

  const task = cloneDeep(askingTask);
  // bypass understanding status to thread response
  if (task.status === AskingTaskStatus.UNDERSTANDING) {
    task.status = AskingTaskStatus.SEARCHING;
    task.type = AskingTaskType.TEXT_TO_SQL;
  }

  const updater = (
    existingData: ThreadDetailQueryData | null,
  ): ThreadDetailQueryData | null => {
    if (!existingData?.thread) {
      return existingData;
    }

    return {
      thread: {
        ...existingData.thread,
        responses: existingData.thread.responses.map(
          (response: DetailedThread['responses'][number]) => {
            if (response.id === threadResponseId) {
              return { ...response, askingTask: task };
            }
            return response;
          },
        ),
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
      (existingData) => {
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

export interface AskPromptSubmitDefaults {
  knowledgeBaseIds?: string[];
  selectedSkillIds?: string[];
}

export default function useAskPrompt(
  threadId?: number,
  submitDefaults?: AskPromptSubmitDefaults,
  updateThreadQuery?: UpdateThreadDetailQuery,
) {
  const [originalQuestion, setOriginalQuestion] = useState<string>('');
  const [threadQuestions, setThreadQuestions] = useState<string[]>([]);
  const submitInFlightRef = useRef(false);
  const askingTaskPollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const instantRecommendPollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  // Handle errors via try/catch blocks rather than onError callback
  const [createAskingTask, createAskingTaskResult] =
    useCreateAskingTaskMutation();
  const [cancelAskingTask] = useCancelAskingTaskMutation({
    onError: () => {
      message.error('停止问答任务失败，请稍后重试');
    },
  });
  const [rerunAskingTask] = useRerunAskingTaskMutation({
    onError: () => {
      message.error('重新执行问答任务失败，请稍后重试');
    },
  });
  const [fetchAskingTask, askingTaskResult] = useAskingTaskLazyQuery({
    pollInterval: ASKING_TASK_POLL_INTERVAL_MS,
  });
  const [fetchAskingStreamTask, askingStreamTaskResult] = useAskingStreamTask();
  const [createInstantRecommendedQuestions] =
    useCreateInstantRecommendedQuestionsMutation({
      onError: () => {
        message.error('生成推荐问题失败，请稍后重试');
      },
    });
  const [fetchInstantRecommendedQuestions, instantRecommendedQuestionsResult] =
    useInstantRecommendedQuestionsLazyQuery({
      pollInterval: INSTANT_RECOMMEND_POLL_INTERVAL_MS,
    });
  const stopAskingTaskPolling = askingTaskResult.stopPolling;
  const stopInstantRecommendPolling =
    instantRecommendedQuestionsResult.stopPolling;

  const clearAskingTaskPollingTimeout = useCallback(() => {
    if (askingTaskPollingTimeoutRef.current) {
      clearTimeout(askingTaskPollingTimeoutRef.current);
      askingTaskPollingTimeoutRef.current = null;
    }
  }, []);

  const clearInstantRecommendPollingTimeout = useCallback(() => {
    if (instantRecommendPollingTimeoutRef.current) {
      clearTimeout(instantRecommendPollingTimeoutRef.current);
      instantRecommendPollingTimeoutRef.current = null;
    }
  }, []);

  const scheduleAskingTaskPollingStop = useCallback(() => {
    clearAskingTaskPollingTimeout();
    askingTaskPollingTimeoutRef.current = setTimeout(() => {
      stopAskingTaskPolling();
      message.warning('问答任务轮询超时，请稍后重试');
    }, ASKING_TASK_POLL_TIMEOUT_MS);
  }, [clearAskingTaskPollingTimeout, stopAskingTaskPolling]);

  const scheduleInstantRecommendPollingStop = useCallback(() => {
    clearInstantRecommendPollingTimeout();
    instantRecommendPollingTimeoutRef.current = setTimeout(() => {
      stopInstantRecommendPolling();
    }, INSTANT_RECOMMEND_POLL_TIMEOUT_MS);
  }, [clearInstantRecommendPollingTimeout, stopInstantRecommendPolling]);

  const fetchAskingTaskWithGuard = useCallback(
    async (taskId: string) => {
      clearAskingTaskPollingTimeout();
      stopAskingTaskPolling();
      const result = await fetchAskingTask({
        variables: { taskId },
      });
      scheduleAskingTaskPollingStop();
      return result;
    },
    [
      clearAskingTaskPollingTimeout,
      fetchAskingTask,
      scheduleAskingTaskPollingStop,
      stopAskingTaskPolling,
    ],
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

  const loading =
    createAskingTaskResult.loading || askingStreamTaskResult.loading;

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
    const previousQuestions = buildRecommendedQuestionHistory(
      threadQuestions,
      originalQuestion,
    );
    if (previousQuestions.length === 0) {
      return;
    }

    try {
      const response = await createInstantRecommendedQuestions({
        variables: { data: { previousQuestions } },
      });
      const taskId = response.data?.createInstantRecommendedQuestions?.id;
      if (!taskId) {
        return;
      }

      fetchInstantRecommendedQuestions({
        variables: { taskId },
      });
      scheduleInstantRecommendPollingStop();
    } catch (_error) {
      message.error('生成推荐问题失败，请稍后重试');
    }
  }, [
    createInstantRecommendedQuestions,
    fetchInstantRecommendedQuestions,
    originalQuestion,
    scheduleInstantRecommendPollingStop,
    threadQuestions,
  ]);

  const checkFetchAskingStreamTask = useCallback(
    (task: NullableAskingTask) => {
      if (
        !task ||
        askingStreamTask ||
        task.status !== AskingTaskStatus.PLANNING ||
        !task.queryId
      ) {
        return;
      }

      fetchAskingStreamTask(task.queryId);
    },
    [askingStreamTask, fetchAskingStreamTask],
  );

  useEffect(() => {
    const isFinished = getIsFinished(askingTask?.status);
    if (isFinished) {
      askingTaskResult.stopPolling();
      clearAskingTaskPollingTimeout();
    }

    // handle update cache for preparing component
    if (isNeedPreparing(askingTask)) {
      if (threadId) {
        handleUpdateThreadCache(
          threadId,
          askingTask,
          askingTaskResult.client,
          updateThreadQuery,
        );
        checkFetchAskingStreamTask(askingTask);
      }
    }
  }, [
    askingTask,
    threadId,
    checkFetchAskingStreamTask,
    clearAskingTaskPollingTimeout,
    updateThreadQuery,
  ]);

  useEffect(() => {
    // handle instant recommended questions
    if (isNeedRecommendedQuestions(askingTask)) {
      void startRecommendedQuestions();
    }
  }, [askingTask?.status, askingTask?.type, startRecommendedQuestions]);

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestions?.status)) {
      stopInstantRecommendPolling();
      clearInstantRecommendPollingTimeout();
    }
  }, [
    clearInstantRecommendPollingTimeout,
    recommendedQuestions,
    stopInstantRecommendPolling,
  ]);

  useEffect(() => {
    return () => {
      clearAskingTaskPollingTimeout();
      clearInstantRecommendPollingTimeout();
    };
  }, [clearAskingTaskPollingTimeout, clearInstantRecommendPollingTimeout]);

  useEffect(() => {
    const taskId = createAskingTaskResult.data?.createAskingTask.id;
    if (taskId && askingTaskType === AskingTaskType.GENERAL) {
      fetchAskingStreamTask(taskId);
    }
  }, [
    askingTaskType,
    createAskingTaskResult.data?.createAskingTask.id,
    fetchAskingStreamTask,
  ]);

  const onStop = useCallback(
    async (queryId?: string) => {
      const taskId =
        queryId || createAskingTaskResult.data?.createAskingTask.id;
      if (taskId) {
        await cancelAskingTask({ variables: { taskId } }).catch(
          () => undefined,
        );
        stopAskingTaskPolling();
        clearAskingTaskPollingTimeout();
      }
    },
    [
      cancelAskingTask,
      clearAskingTaskPollingTimeout,
      createAskingTaskResult.data?.createAskingTask.id,
      stopAskingTaskPolling,
    ],
  );

  const onReRun = useCallback(
    async (threadResponse: ThreadResponse) => {
      askingStreamTaskResult.reset();
      setOriginalQuestion(threadResponse.question);
      try {
        const response = await rerunAskingTask({
          variables: { responseId: threadResponse.id },
        });
        const rerunTaskId = response.data?.rerunAskingTask?.id;
        if (!rerunTaskId) {
          message.error('重新执行失败，请稍后重试');
          return;
        }

        const { data } = await fetchAskingTaskWithGuard(rerunTaskId);
        if (!threadId || !data?.askingTask) {
          return;
        }
        // update the asking task in cache manually
        handleUpdateRerunAskingTaskCache(
          threadId,
          threadResponse.id,
          data.askingTask,
          askingTaskResult.client,
          updateThreadQuery,
        );
      } catch (_error) {
        message.error('重新执行失败，请稍后重试');
      }
    },
    [
      askingStreamTaskResult,
      askingTaskResult.client,
      fetchAskingTaskWithGuard,
      rerunAskingTask,
      threadId,
      updateThreadQuery,
    ],
  );

  const onSubmit = useCallback(
    async (value: string) => {
      if (submitInFlightRef.current) {
        return;
      }

      submitInFlightRef.current = true;
      askingStreamTaskResult.reset();
      setOriginalQuestion(value);
      try {
        const response = await createAskingTask({
          variables: {
            data: {
              question: value,
              threadId,
              knowledgeBaseIds: submitDefaults?.knowledgeBaseIds,
              selectedSkillIds: submitDefaults?.selectedSkillIds,
            },
          },
        });
        const askingTaskId = response.data?.createAskingTask?.id;
        if (!askingTaskId) {
          message.error('提交问题失败，请稍后重试');
          return;
        }

        await fetchAskingTaskWithGuard(askingTaskId);
      } catch (_error) {
        message.error('提交问题失败，请稍后重试');
      } finally {
        submitInFlightRef.current = false;
      }
    },
    [
      askingStreamTaskResult,
      createAskingTask,
      fetchAskingTaskWithGuard,
      submitDefaults?.knowledgeBaseIds,
      submitDefaults?.selectedSkillIds,
      threadId,
    ],
  );

  const onFetching = useCallback(
    async (queryId: string) => {
      await fetchAskingTaskWithGuard(queryId);
    },
    [fetchAskingTaskWithGuard],
  );

  const onStopPolling = useCallback(() => {
    clearAskingTaskPollingTimeout();
    stopAskingTaskPolling();
  }, [clearAskingTaskPollingTimeout, stopAskingTaskPolling]);

  const onStopStreaming = useCallback(
    () => askingStreamTaskResult.reset(),
    [askingStreamTaskResult],
  );

  const onStopRecommend = useCallback(() => {
    clearInstantRecommendPollingTimeout();
    stopInstantRecommendPolling();
  }, [clearInstantRecommendPollingTimeout, stopInstantRecommendPolling]);

  const onStoreThreadQuestions = useCallback((questions: string[]) => {
    setThreadQuestions(questions);
  }, []);

  const inputProps = useMemo(
    () => ({
      placeholder: threadId
        ? '继续追问以深入分析你的数据'
        : '输入问题开始探索你的数据',
    }),
    [threadId],
  );

  return useMemo(
    () => ({
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
      inputProps,
    }),
    [
      data,
      inputProps,
      loading,
      onFetching,
      onReRun,
      onStop,
      onStopPolling,
      onStopRecommend,
      onStopStreaming,
      onStoreThreadQuestions,
      onSubmit,
    ],
  );
}
