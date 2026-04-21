import { useCallback, useRef } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import { ANSWER_FINALIZATION_POLL_TIMEOUT_MS } from '@/utils/askingTimeouts';

const THREAD_RESPONSE_POLL_TIMEOUT_MS = ANSWER_FINALIZATION_POLL_TIMEOUT_MS;
const THREAD_RECOMMEND_POLL_TIMEOUT_MS = 20_000;

export function useThreadPollingTimeouts({
  stopThreadRecommendationQuestionsHookPolling,
  stopThreadResponseHookPolling,
}: {
  stopThreadRecommendationQuestionsHookPolling: () => void;
  stopThreadResponseHookPolling: () => void;
}) {
  const threadRecommendPollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const threadResponsePollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const clearThreadResponsePollingTimeout = useCallback(() => {
    if (threadResponsePollingTimeoutRef.current) {
      clearTimeout(threadResponsePollingTimeoutRef.current);
      threadResponsePollingTimeoutRef.current = null;
    }
  }, []);

  const clearThreadRecommendPollingTimeout = useCallback(() => {
    if (threadRecommendPollingTimeoutRef.current) {
      clearTimeout(threadRecommendPollingTimeoutRef.current);
      threadRecommendPollingTimeoutRef.current = null;
    }
  }, []);

  const stopThreadResponsePolling = useCallback(() => {
    stopThreadResponseHookPolling();
    clearThreadResponsePollingTimeout();
  }, [clearThreadResponsePollingTimeout, stopThreadResponseHookPolling]);

  const stopThreadRecommendPolling = useCallback(() => {
    stopThreadRecommendationQuestionsHookPolling();
    clearThreadRecommendPollingTimeout();
  }, [
    clearThreadRecommendPollingTimeout,
    stopThreadRecommendationQuestionsHookPolling,
  ]);

  const scheduleThreadResponsePollingStop = useCallback(() => {
    clearThreadResponsePollingTimeout();
    threadResponsePollingTimeoutRef.current = setTimeout(() => {
      stopThreadResponseHookPolling();
      message.warning('对话结果轮询超时，请稍后重试');
    }, THREAD_RESPONSE_POLL_TIMEOUT_MS);
  }, [clearThreadResponsePollingTimeout, stopThreadResponseHookPolling]);

  const scheduleThreadRecommendPollingStop = useCallback(() => {
    clearThreadRecommendPollingTimeout();
    threadRecommendPollingTimeoutRef.current = setTimeout(() => {
      stopThreadRecommendationQuestionsHookPolling();
    }, THREAD_RECOMMEND_POLL_TIMEOUT_MS);
  }, [
    clearThreadRecommendPollingTimeout,
    stopThreadRecommendationQuestionsHookPolling,
  ]);

  return {
    scheduleThreadRecommendPollingStop,
    scheduleThreadResponsePollingStop,
    stopThreadRecommendPolling,
    stopThreadResponsePolling,
  };
}

export default useThreadPollingTimeouts;
