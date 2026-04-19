import { useCallback } from 'react';
import { message } from 'antd';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { triggerThreadRecommendationQuestions as triggerThreadRecommendationQuestionsRequest } from '@/utils/threadRest';

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

export function useThreadRecommendedQuestionsAction({
  currentThreadId,
  fetchThreadRecommendationQuestions,
  runtimeScopeSelector,
  scheduleThreadRecommendPollingStop,
  setShowRecommendedQuestions,
  stopThreadRecommendPolling,
  threadRecommendRequestInFlightRef,
}: {
  currentThreadId?: number | null;
  fetchThreadRecommendationQuestions: (threadId: number) => Promise<unknown>;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  scheduleThreadRecommendPollingStop: () => void;
  setShowRecommendedQuestions: React.Dispatch<React.SetStateAction<boolean>>;
  stopThreadRecommendPolling: () => void;
  threadRecommendRequestInFlightRef: React.MutableRefObject<boolean>;
}) {
  return useCallback(async () => {
    if (!currentThreadId) {
      message.error('当前对话尚未就绪，请稍后再试');
      return;
    }
    if (threadRecommendRequestInFlightRef.current) {
      return;
    }

    threadRecommendRequestInFlightRef.current = true;
    setShowRecommendedQuestions(true);
    stopThreadRecommendPolling();
    try {
      await triggerThreadRecommendationQuestionsRequest(
        runtimeScopeSelector,
        currentThreadId,
      );
      void fetchThreadRecommendationQuestions(currentThreadId).finally(() => {
        scheduleThreadRecommendPollingStop();
        threadRecommendRequestInFlightRef.current = false;
      });
    } catch (error) {
      threadRecommendRequestInFlightRef.current = false;
      reportThreadError(error, '生成推荐追问失败，请稍后重试');
    }
  }, [
    currentThreadId,
    fetchThreadRecommendationQuestions,
    runtimeScopeSelector,
    scheduleThreadRecommendPollingStop,
    setShowRecommendedQuestions,
    stopThreadRecommendPolling,
    threadRecommendRequestInFlightRef,
  ]);
}
