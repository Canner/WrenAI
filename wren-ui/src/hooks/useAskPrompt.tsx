import { useEffect, useMemo } from 'react';
import {
  AskingTaskStatus,
  ExplainTaskStatus,
} from '@/apollo/client/graphql/__types__';
import {
  useAskingTaskLazyQuery,
  useCancelAskingTaskMutation,
  useCreateAskingTaskMutation,
} from '@/apollo/client/graphql/home.generated';

export const getIsExplainFinished = (status: ExplainTaskStatus) =>
  [ExplainTaskStatus.FINISHED, ExplainTaskStatus.FAILED].includes(status);

export const getIsAskingFinished = (status: AskingTaskStatus) =>
  [
    AskingTaskStatus.FINISHED,
    AskingTaskStatus.FAILED,
    AskingTaskStatus.STOPPED,
  ].includes(status);

export const checkExplainExisted = (explain?: {
  queryId?: string;
  status?: ExplainTaskStatus;
}) => {
  // if the queryId is not empty, it means the question is explainable
  return !!explain?.queryId ? explain.status : undefined;
};

export const getIsFinished = (
  askingStatus: AskingTaskStatus,
  explainStatus?: ExplainTaskStatus,
) => {
  const isAskingFinished = getIsAskingFinished(askingStatus);
  if (explainStatus) {
    const isExplainFinished = getIsExplainFinished(explainStatus);
    return isAskingFinished && isExplainFinished;
  }
  return isAskingFinished;
};

export default function useAskPrompt(threadId?: number) {
  const [createAskingTask, createAskingTaskResult] =
    useCreateAskingTaskMutation();
  const [cancelAskingTask] = useCancelAskingTaskMutation();
  const [fetchAskingTask, askingTaskResult] = useAskingTaskLazyQuery({
    pollInterval: 1000,
  });
  const data = useMemo(
    () => askingTaskResult.data?.askingTask || null,
    [askingTaskResult.data],
  );
  const isFinished = useMemo(() => getIsFinished(data?.status), [data]);

  useEffect(() => {
    if (isFinished) askingTaskResult.stopPolling();
  }, [isFinished]);

  const onStop = () => {
    const taskId = createAskingTaskResult.data?.createAskingTask.id;
    if (taskId) {
      cancelAskingTask({ variables: { taskId } }).catch((error) =>
        console.error(error),
      );
    }
  };

  const onSubmit = async (value) => {
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

  return {
    data,
    onStop,
    onSubmit,
  };
}
