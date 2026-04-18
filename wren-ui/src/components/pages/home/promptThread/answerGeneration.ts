import type { MutableRefObject } from 'react';
import { canGenerateAnswer } from '@/hooks/useAskPrompt';
import {
  ThreadResponse,
  ThreadResponseAnswerDetail,
  ThreadResponseAnswerStatus,
} from '@/types/home';

export const getAnswerIsFinished = (
  status?: ThreadResponseAnswerStatus | null,
) =>
  status != null &&
  [
    ThreadResponseAnswerStatus.FINISHED,
    ThreadResponseAnswerStatus.FAILED,
    ThreadResponseAnswerStatus.INTERRUPTED,
  ].includes(status);

export const isNeedGenerateAnswer = (
  answerDetail?: ThreadResponseAnswerDetail | null,
  sql?: string | null,
) => {
  if (!sql?.trim()) {
    return false;
  }

  const status = answerDetail?.status || null;
  const hasQueryId =
    answerDetail?.queryId !== null &&
    answerDetail?.queryId !== undefined &&
    String(answerDetail?.queryId).trim() !== '';
  const isFinished = getAnswerIsFinished(status);
  const isProcessing = [
    ThreadResponseAnswerStatus.NOT_STARTED,
    ThreadResponseAnswerStatus.PREPROCESSING,
    ThreadResponseAnswerStatus.FETCHING_DATA,
  ].includes(status as ThreadResponseAnswerStatus);
  return !hasQueryId && !isFinished && !isProcessing;
};

export const shouldAutoGenerateAnswer = ({
  isBreakdownOnly,
  askingTask,
  adjustmentTask,
  answerDetail,
  sql,
}: {
  isBreakdownOnly: boolean;
  askingTask?: ThreadResponse['askingTask'] | null;
  adjustmentTask?: ThreadResponse['adjustmentTask'] | null;
  answerDetail?: ThreadResponseAnswerDetail | null;
  sql?: string | null;
}) => {
  if (isBreakdownOnly) {
    return false;
  }

  return (
    canGenerateAnswer(askingTask, adjustmentTask) &&
    isNeedGenerateAnswer(answerDetail, sql)
  );
};

export const scheduleAutoGenerateAnswer = ({
  requestRef,
  requestKey,
  onGenerate,
  delayMs = 250,
}: {
  requestRef: MutableRefObject<string | null>;
  requestKey: string;
  onGenerate: () => void;
  delayMs?: number;
}) => {
  const timerId = setTimeout(() => {
    if (requestRef.current === requestKey) {
      return;
    }

    requestRef.current = requestKey;
    onGenerate();
  }, delayMs);

  return () => {
    clearTimeout(timerId);
  };
};
