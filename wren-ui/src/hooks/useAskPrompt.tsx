import { useCallback, useEffect, useMemo, useState } from 'react';
import { uniq } from 'lodash';
import {
  AskingTask,
  AskingTaskStatus,
  AskingTaskType,
  RecommendedQuestionsTask,
  RecommendedQuestionsTaskStatus,
} from '@/apollo/client/graphql/__types__';
import {
  useAskingTaskLazyQuery,
  useCancelAskingTaskMutation,
  useCreateAskingTaskMutation,
  useCreateInstantRecommendedQuestionsMutation,
  useInstantRecommendedQuestionsLazyQuery,
} from '@/apollo/client/graphql/home.generated';
import useAskingStreamTask from './useAskingStreamTask';

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

export const isRecommendedFinished = (status: RecommendedQuestionsTaskStatus) =>
  [
    RecommendedQuestionsTaskStatus.FINISHED,
    RecommendedQuestionsTaskStatus.FAILED,

    // for existing thread response & existing projects that are not executed to generate recommendation questions
    RecommendedQuestionsTaskStatus.NOT_STARTED,
  ].includes(status);

const isNeedRecommendedQuestions = (askingTask: AskingTask) => {
  return (
    [AskingTaskType.GENERAL, AskingTaskType.MISLEADING_QUERY].includes(
      askingTask?.type,
    ) || askingTask?.status === AskingTaskStatus.FAILED
  );
};

export default function useAskPrompt(threadId?: number) {
  const [originalQuestion, setOriginalQuestion] = useState<string>('');
  const [threadQuestions, setThreadQuestions] = useState<string[]>([]);
  const [createAskingTask, createAskingTaskResult] =
    useCreateAskingTaskMutation();
  const [cancelAskingTask] = useCancelAskingTaskMutation();
  const [fetchAskingTask, askingTaskResult] = useAskingTaskLazyQuery({
    pollInterval: 1000,
  });
  const [fetchAskingStreamTask, askingStreamTaskResult] = useAskingStreamTask();
  const [createInstantRecommendedQuestions] =
    useCreateInstantRecommendedQuestionsMutation();
  const [fetchInstantRecommendedQuestions, instantRecommendedQuestionsResult] =
    useInstantRecommendedQuestionsLazyQuery({
      pollInterval: 1000,
    });

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
    const previousQuestions = [
      // slice the last 5 questions in threadQuestions
      ...uniq(threadQuestions).slice(-5),
      originalQuestion,
    ];
    const response = await createInstantRecommendedQuestions({
      variables: { data: { previousQuestions } },
    });
    fetchInstantRecommendedQuestions({
      variables: { taskId: response.data.createInstantRecommendedQuestions.id },
    });
  }, [originalQuestion]);

  useEffect(() => {
    const isFinished = getIsFinished(askingTask?.status);
    if (isFinished) askingTaskResult.stopPolling();

    if (isNeedRecommendedQuestions(askingTask)) {
      startRecommendedQuestions();
    }
  }, [askingTask]);

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestions?.status))
      instantRecommendedQuestionsResult.stopPolling();
  }, [recommendedQuestions]);

  useEffect(() => {
    const taskId = createAskingTaskResult.data?.createAskingTask.id;
    if (taskId && askingTaskType === AskingTaskType.GENERAL) {
      fetchAskingStreamTask(taskId);
    }
  }, [askingTaskType, createAskingTaskResult.data]);

  const onStop = () => {
    const taskId = createAskingTaskResult.data?.createAskingTask.id;
    if (taskId) {
      cancelAskingTask({ variables: { taskId } }).catch((error) =>
        console.error(error),
      );
    }
  };

  const onSubmit = async (value) => {
    setOriginalQuestion(value);
    try {
      const response = await createAskingTask({
        variables: { data: { question: value, threadId } },
      });
      await fetchAskingTask({
        variables: { taskId: response.data.createAskingTask.id },
      });
    } catch (error) {
      console.error(error);
    }
  };

  const onStopPolling = () => askingTaskResult.stopPolling();

  const onStopStreaming = () => askingStreamTaskResult.reset();

  const onStopRecommend = () => instantRecommendedQuestionsResult.stopPolling();

  const onStoreThreadQuestions = (questions: string[]) =>
    setThreadQuestions(questions);

  return {
    data,
    loading,
    onStop,
    onSubmit,
    onStopPolling,
    onStopStreaming,
    onStopRecommend,
    onStoreThreadQuestions,
  };
}
