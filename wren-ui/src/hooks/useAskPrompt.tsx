import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloneDeep, uniq } from 'lodash';
import { message } from 'antd';
import {
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import {
  AdjustmentTask,
  AskingTask,
  AskingTaskStatus,
  AskingTaskType,
  RecommendedQuestionsTask,
  RecommendedQuestionsTaskStatus,
  ThreadResponse,
} from '@/types/api';
import {
  cancelAskingTask as cancelAskingTaskRest,
  createAskingTask as createAskingTaskRest,
  createInstantRecommendedQuestions as createInstantRecommendedQuestionsRest,
  getAskingTask as getAskingTaskRest,
  getInstantRecommendedQuestions as getInstantRecommendedQuestionsRest,
  rerunAskingTask as rerunAskingTaskRest,
} from '@/utils/homeRest';
import useAskingStreamTask from './useAskingStreamTask';
import type { UpdateThreadDetailQuery } from './useThreadDetail';

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
  askingTask: NullableAskingTask,
  updateThreadQuery?: UpdateThreadDetailQuery,
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

const handleUpdateRerunAskingTaskCache = ({
  threadResponseId,
  askingTask,
  updateThreadQuery,
}: {
  threadResponseId: number;
  askingTask: NullableAskingTask;
  updateThreadQuery?: UpdateThreadDetailQuery;
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

export interface AskPromptSubmitDefaults {
  knowledgeBaseIds?: string[];
  selectedSkillIds?: string[];
}

const resolveRuntimeScopeSelector = (selector?: ClientRuntimeScopeSelector) =>
  selector || resolveClientRuntimeScopeSelector();

export default function useAskPrompt(
  threadId?: number,
  submitDefaults?: AskPromptSubmitDefaults,
  updateThreadQuery?: UpdateThreadDetailQuery,
  runtimeScopeSelector?: ClientRuntimeScopeSelector,
) {
  const [originalQuestion, setOriginalQuestion] = useState<string>('');
  const [threadQuestions, setThreadQuestions] = useState<string[]>([]);
  const [askingTask, setAskingTask] = useState<AskingTask | null>(null);
  const [recommendedQuestions, setRecommendedQuestions] =
    useState<RecommendedQuestionsTask | null>(null);
  const [askingTaskLoading, setAskingTaskLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);
  const askingTaskPollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const askingTaskPollingRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const askingTaskPollingSessionRef = useRef(0);
  const instantRecommendPollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const instantRecommendPollingRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const instantRecommendPollingSessionRef = useRef(0);
  const lastTaskIdRef = useRef<string | null>(null);
  const [fetchAskingStreamTask, askingStreamTaskResult] = useAskingStreamTask();

  const stopAskingTaskPolling = useCallback(() => {
    askingTaskPollingSessionRef.current += 1;
    if (askingTaskPollingRef.current) {
      clearTimeout(askingTaskPollingRef.current);
      askingTaskPollingRef.current = null;
    }
    if (askingTaskPollingTimeoutRef.current) {
      clearTimeout(askingTaskPollingTimeoutRef.current);
      askingTaskPollingTimeoutRef.current = null;
    }
  }, []);

  const stopInstantRecommendPolling = useCallback(() => {
    instantRecommendPollingSessionRef.current += 1;
    if (instantRecommendPollingRef.current) {
      clearTimeout(instantRecommendPollingRef.current);
      instantRecommendPollingRef.current = null;
    }
    if (instantRecommendPollingTimeoutRef.current) {
      clearTimeout(instantRecommendPollingTimeoutRef.current);
      instantRecommendPollingTimeoutRef.current = null;
    }
  }, []);

  const fetchAskingTaskWithGuard = useCallback(
    async (taskId: string) => {
      const selector = resolveRuntimeScopeSelector(runtimeScopeSelector);
      stopAskingTaskPolling();
      const sessionId = askingTaskPollingSessionRef.current;
      lastTaskIdRef.current = taskId;

      askingTaskPollingTimeoutRef.current = setTimeout(() => {
        if (askingTaskPollingSessionRef.current !== sessionId) {
          return;
        }
        stopAskingTaskPolling();
        message.warning('问答任务轮询超时，请稍后重试');
      }, ASKING_TASK_POLL_TIMEOUT_MS);

      const run = async (): Promise<AskingTask | null> => {
        setAskingTaskLoading(true);
        try {
          const nextTask = await getAskingTaskRest(selector, taskId);
          if (askingTaskPollingSessionRef.current !== sessionId) {
            return nextTask;
          }

          setAskingTask(nextTask);
          if (!getIsFinished(nextTask?.status)) {
            askingTaskPollingRef.current = setTimeout(() => {
              void run().catch((error) => {
                message.error(
                  error instanceof Error
                    ? error.message
                    : '加载问答任务失败，请稍后重试',
                );
              });
            }, ASKING_TASK_POLL_INTERVAL_MS);
          } else if (askingTaskPollingTimeoutRef.current) {
            clearTimeout(askingTaskPollingTimeoutRef.current);
            askingTaskPollingTimeoutRef.current = null;
          }
          return nextTask;
        } finally {
          if (askingTaskPollingSessionRef.current === sessionId) {
            setAskingTaskLoading(false);
          }
        }
      };

      return run();
    },
    [runtimeScopeSelector, stopAskingTaskPolling],
  );

  const startRecommendedQuestions = useCallback(async () => {
    const previousQuestions = buildRecommendedQuestionHistory(
      threadQuestions,
      originalQuestion,
    );
    if (previousQuestions.length === 0) {
      return;
    }

    const selector = resolveRuntimeScopeSelector(runtimeScopeSelector);
    try {
      const task = await createInstantRecommendedQuestionsRest(selector, {
        previousQuestions,
      });
      const taskId = task.id;
      if (!taskId) {
        return;
      }

      stopInstantRecommendPolling();
      const sessionId = instantRecommendPollingSessionRef.current;
      instantRecommendPollingTimeoutRef.current = setTimeout(() => {
        if (instantRecommendPollingSessionRef.current !== sessionId) {
          return;
        }
        stopInstantRecommendPolling();
      }, INSTANT_RECOMMEND_POLL_TIMEOUT_MS);

      const run = async (): Promise<RecommendedQuestionsTask | null> => {
        const payload = await getInstantRecommendedQuestionsRest(
          selector,
          taskId,
        );
        if (instantRecommendPollingSessionRef.current !== sessionId) {
          return payload || null;
        }

        const nextQuestions = payload || null;
        setRecommendedQuestions(nextQuestions);
        if (!isRecommendedFinished(nextQuestions?.status)) {
          instantRecommendPollingRef.current = setTimeout(() => {
            void run().catch(() => {
              message.error('生成推荐问题失败，请稍后重试');
            });
          }, INSTANT_RECOMMEND_POLL_INTERVAL_MS);
        } else if (instantRecommendPollingTimeoutRef.current) {
          clearTimeout(instantRecommendPollingTimeoutRef.current);
          instantRecommendPollingTimeoutRef.current = null;
        }
        return nextQuestions;
      };

      await run();
    } catch (_error) {
      message.error('生成推荐问题失败，请稍后重试');
    }
  }, [
    originalQuestion,
    runtimeScopeSelector,
    stopInstantRecommendPolling,
    threadQuestions,
  ]);

  const checkFetchAskingStreamTask = useCallback(
    (task: NullableAskingTask) => {
      if (
        !task ||
        askingStreamTaskResult.data ||
        task.status !== AskingTaskStatus.PLANNING ||
        !task.queryId
      ) {
        return;
      }

      fetchAskingStreamTask(task.queryId);
    },
    [askingStreamTaskResult.data, fetchAskingStreamTask],
  );

  useEffect(() => {
    if (getIsFinished(askingTask?.status)) {
      stopAskingTaskPolling();
    }

    if (isNeedPreparing(askingTask)) {
      handleUpdateThreadCache(askingTask, updateThreadQuery);
      checkFetchAskingStreamTask(askingTask);
    }
  }, [
    askingTask,
    checkFetchAskingStreamTask,
    stopAskingTaskPolling,
    updateThreadQuery,
  ]);

  useEffect(() => {
    if (isNeedRecommendedQuestions(askingTask)) {
      void startRecommendedQuestions();
    }
  }, [askingTask?.status, askingTask?.type, startRecommendedQuestions]);

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestions?.status)) {
      stopInstantRecommendPolling();
    }
  }, [recommendedQuestions?.status, stopInstantRecommendPolling]);

  useEffect(() => {
    return () => {
      stopAskingTaskPolling();
      stopInstantRecommendPolling();
    };
  }, [stopAskingTaskPolling, stopInstantRecommendPolling]);

  const data = useMemo(
    () => ({
      originalQuestion,
      askingTask,
      askingStreamTask: askingStreamTaskResult.data,
      recommendedQuestions,
    }),
    [
      askingStreamTaskResult.data,
      askingTask,
      originalQuestion,
      recommendedQuestions,
    ],
  );

  const loading =
    submitting || askingTaskLoading || askingStreamTaskResult.loading;

  const onStop = useCallback(
    async (queryId?: string) => {
      const selector = resolveRuntimeScopeSelector(runtimeScopeSelector);
      const taskId = queryId || lastTaskIdRef.current;
      if (!taskId) {
        return;
      }

      try {
        await cancelAskingTaskRest(selector, taskId);
      } catch (_error) {
        message.error('停止问答任务失败，请稍后重试');
      } finally {
        stopAskingTaskPolling();
      }
    },
    [runtimeScopeSelector, stopAskingTaskPolling],
  );

  const onReRun = useCallback(
    async (threadResponse: ThreadResponse) => {
      const selector = resolveRuntimeScopeSelector(runtimeScopeSelector);
      askingStreamTaskResult.reset();
      setOriginalQuestion(threadResponse.question);
      try {
        const rerunTask = await rerunAskingTaskRest(
          selector,
          threadResponse.id,
        );
        const rerunTaskId = rerunTask.id;
        if (!rerunTaskId) {
          message.error('重新执行失败，请稍后重试');
          return;
        }

        const nextTask = await fetchAskingTaskWithGuard(rerunTaskId);
        if (nextTask?.type === AskingTaskType.GENERAL) {
          fetchAskingStreamTask(rerunTaskId);
        }
        handleUpdateRerunAskingTaskCache({
          threadResponseId: threadResponse.id,
          askingTask: nextTask,
          updateThreadQuery,
        });
      } catch (_error) {
        message.error('重新执行失败，请稍后重试');
      }
    },
    [
      askingStreamTaskResult,
      fetchAskingStreamTask,
      fetchAskingTaskWithGuard,
      runtimeScopeSelector,
      updateThreadQuery,
    ],
  );

  const onSubmit = useCallback(
    async (value: string) => {
      if (submitInFlightRef.current) {
        return;
      }

      const normalizedQuestion = value.trim();
      if (!normalizedQuestion) {
        return;
      }

      submitInFlightRef.current = true;
      setSubmitting(true);
      askingStreamTaskResult.reset();
      setOriginalQuestion(normalizedQuestion);

      const selector = resolveRuntimeScopeSelector(runtimeScopeSelector);
      try {
        const task = await createAskingTaskRest(selector, {
          question: normalizedQuestion,
          threadId,
          knowledgeBaseIds: submitDefaults?.knowledgeBaseIds,
          selectedSkillIds: submitDefaults?.selectedSkillIds,
        });
        const askingTaskId = task.id;
        if (!askingTaskId) {
          message.error('提交问题失败，请稍后重试');
          return;
        }

        const nextTask = await fetchAskingTaskWithGuard(askingTaskId);
        if (nextTask?.type === AskingTaskType.GENERAL) {
          fetchAskingStreamTask(askingTaskId);
        }
      } catch (_error) {
        message.error('提交问题失败，请稍后重试');
      } finally {
        submitInFlightRef.current = false;
        setSubmitting(false);
      }
    },
    [
      askingStreamTaskResult,
      fetchAskingStreamTask,
      fetchAskingTaskWithGuard,
      runtimeScopeSelector,
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
    stopAskingTaskPolling();
  }, [stopAskingTaskPolling]);

  const onStopStreaming = useCallback(
    () => askingStreamTaskResult.reset(),
    [askingStreamTaskResult],
  );

  const onStopRecommend = useCallback(() => {
    stopInstantRecommendPolling();
  }, [stopInstantRecommendPolling]);

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
