import { useEffect, useMemo, useState } from 'react';
import {
  AskingTask,
  AskingTaskStatus,
  AskingTaskType,
} from '@/apollo/client/graphql/__types__';
import {
  useAskingTaskLazyQuery,
  useCancelAskingTaskMutation,
  useCreateAskingTaskMutation,
} from '@/apollo/client/graphql/home.generated';
import useAskingStreamTask from './useAskingStreamTask';

export interface AskPromptData {
  originalQuestion: string;
  askingTask?: AskingTask;
  askingStreamTask?: string;
}

export const getIsFinished = (status: AskingTaskStatus) =>
  [
    AskingTaskStatus.FINISHED,
    AskingTaskStatus.FAILED,
    AskingTaskStatus.STOPPED,
  ].includes(status);

export default function useAskPrompt(threadId?: number) {
  const [originalQuestion, setOriginalQuestion] = useState<string | null>(null);
  const [createAskingTask, createAskingTaskResult] =
    useCreateAskingTaskMutation();
  const [cancelAskingTask] = useCancelAskingTaskMutation();
  const [fetchAskingTask, askingTaskResult] = useAskingTaskLazyQuery({
    pollInterval: 1000,
  });
  const [fetchAskingStreamTask, askingStreamTaskResult] = useAskingStreamTask();

  const askingTask = useMemo(
    () => askingTaskResult.data?.askingTask || null,
    [askingTaskResult.data],
  );
  const askingTaskType = useMemo(() => askingTask?.type, [askingTask?.type]);
  const isFinished = useMemo(
    () => getIsFinished(askingTask?.status),
    [askingTask],
  );
  const askingStreamTask = askingStreamTaskResult.data;

  const loading = askingStreamTaskResult.loading;

  const data = useMemo(
    () => ({ originalQuestion, askingTask, askingStreamTask }),
    [originalQuestion, askingTask, askingStreamTask],
  );

  useEffect(() => {
    if (isFinished) askingTaskResult.stopPolling();
  }, [isFinished]);

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

  return {
    data,
    loading,
    onStop,
    onSubmit,
    onStopPolling,
    onStopStreaming,
  };
}
